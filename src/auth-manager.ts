import * as fs from 'fs';
import { promises as fsp } from 'fs';
import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';

export type AuthDetection = {
  mode: 'ServiceAccount' | 'ADC' | 'None';
  account?: string;
  project?: string;
};

function execCmd(cmd: string, timeoutMs = 5000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Returns the OS-specific path to the gcloud Application Default Credentials JSON.
 * - macOS/Linux: ~/.config/gcloud/application_default_credentials.json
 * - Windows: %APPDATA%\gcloud\application_default_credentials.json
 */
export function getGcloudAdcPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'gcloud', 'application_default_credentials.json');
  }
  // darwin/linux
  return path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}

/**
 * Returns the OS-specific path to the gcloud config directory that contains ADC.
 * - macOS/Linux: ~/.config/gcloud
 * - Windows: %APPDATA%\gcloud
 */
export function getGcloudAdcDirPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'gcloud');
  }
  // darwin/linux
  return path.join(os.homedir(), '.config', 'gcloud');
}

/**
 * Detects current authentication/account/project using ADC.
 * - If GOOGLE_APPLICATION_CREDENTIALS points to a file: treat as Service Account, read client_email.
 * - Else, tries gcloud active account and project.
 * - preferredProject (from workspaceState) is used when SA mode is detected and no project can be inferred.
 */
export async function detectAuth(preferredProject?: string): Promise<AuthDetection> {
  try {
    // a) GOOGLE_APPLICATION_CREDENTIALS -> Service Account (only if type === 'service_account')
    const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credsPath && fs.existsSync(credsPath)) {
      try {
        const raw = await fsp.readFile(credsPath, 'utf8');
        const json = JSON.parse(raw) as { type?: string; client_email?: string; project_id?: string };
        if (json.type === 'service_account') {
          const account = (json.client_email || 'Service Account').trim() || 'Service Account';
          const project = (preferredProject?.trim() || json.project_id || '').trim();
          return {
            mode: 'ServiceAccount',
            account,
            project: project || undefined,
          };
        }
        // If JSON exists but not expected type, fall through
      } catch {
        // Unreadable or invalid JSON; fall through to next checks
      }
    }

    // b) ADC file -> Authorized user
    const adcPath = getGcloudAdcPath();
    if (fs.existsSync(adcPath)) {
      try {
        const raw = await fsp.readFile(adcPath, 'utf8');
        const json = JSON.parse(raw) as { type?: string; quota_project_id?: string };
        if (json.type === 'authorized_user') {
          // Resolve account (best-effort)
          let account: string | undefined;
          try {
            const { stdout } = await execCmd('gcloud auth list --filter=status:ACTIVE --format=value(account)', 4000);
            const a = (stdout || '').trim();
            account = a || undefined;
          } catch {
            // ignore
          }
          if (!account) {
            account = 'ADC user';
          }

          // Resolve project (preferredProject -> quota_project_id -> gcloud config)
          let project: string | undefined = (preferredProject?.trim() || undefined);
          if (!project && (json.quota_project_id || '').trim()) {
            project = json.quota_project_id!.trim();
          }
          if (!project) {
            try {
              const { stdout } = await execCmd('gcloud config get-value project', 4000);
              const p = (stdout || '').trim();
              if (p && p.toLowerCase() !== '(unset)') {
                project = p;
              }
            } catch {
              // ignore
            }
          }

          return { mode: 'ADC', account, project };
        } else {
          // Unexpected type; fall through to gcloud CLI detection
          console.warn('[Auth] ADC file present but not "authorized_user"; falling back.');
        }
      } catch {
        // ADC file unreadable; fall through
        console.warn('[Auth] Failed to read/parse ADC file; falling back.');
      }
    }

    // c) Fallback to gcloud CLI active account + project (still treated as ADC)
    try {
      const [{ stdout: acctOut }, { stdout: projOut }] = await Promise.all([
        execCmd('gcloud auth list --filter=status:ACTIVE --format=value(account)', 4000),
        execCmd('gcloud config get-value project', 4000),
      ]);
      const account = (acctOut || '').trim();
      const projRaw = (projOut || '').trim();
      const project = projRaw && projRaw.toLowerCase() !== '(unset)' ? projRaw : undefined;
      if (account) {
        return { mode: 'ADC', account, project };
      }
    } catch {
      // ignore
    }

    // d) None
    return { mode: 'None' };
  } catch {
    return { mode: 'None' };
  }
}

/**
 * Best-effort list of accessible GCP projects via gcloud.
 * Returns empty array on any error.
 */
export async function listProjects(): Promise<{ id: string; name?: string }[]> {
  try {
    const { stdout } = await execCmd('gcloud projects list --format=value(projectId)');
    const ids = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return ids.map((id) => ({ id }));
  } catch {
    return [];
  }
}