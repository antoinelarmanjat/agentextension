import * as fs from 'fs';
import { promises as fsp } from 'fs';
import { exec } from 'child_process';

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
 * Detects current authentication/account/project using ADC.
 * - If GOOGLE_APPLICATION_CREDENTIALS points to a file: treat as Service Account, read client_email.
 * - Else, tries gcloud active account and project.
 * - preferredProject (from workspaceState) is used when SA mode is detected and no project can be inferred.
 */
export async function detectAuth(preferredProject?: string): Promise<AuthDetection> {
  try {
    const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credsPath && fs.existsSync(credsPath)) {
      try {
        const raw = await fsp.readFile(credsPath, 'utf8');
        const json = JSON.parse(raw) as { client_email?: string };
        const account = (json.client_email || '').trim();
        return {
          mode: 'ServiceAccount',
          account: account || undefined,
          project: preferredProject || undefined,
        };
      } catch {
        // Fall through to gcloud path if SA JSON is unreadable
      }
    }

    // Try gcloud ADC user
    try {
      const [{ stdout: acctOut }, { stdout: projOut }] = await Promise.all([
        execCmd('gcloud auth list --filter=status:ACTIVE --format=value(account)'),
        execCmd('gcloud config get-value project'),
      ]);
      const account = (acctOut || '').trim();
      const project = (projOut || '').trim();
      if (account) {
        return {
          mode: 'ADC',
          account,
          project: project || undefined,
        };
      }
    } catch {
      // ignore, fall through to None
    }

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