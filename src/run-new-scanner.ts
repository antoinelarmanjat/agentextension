/*
import { scanDirectory, buildHierarchy } from './new-agent-scanner';
import * as path from 'path';

const rootPath = process.cwd();

// Custom replacer function to handle circular references
const circularReplacer = () => {
    const seen = new WeakSet();
    return (key: string, value: any) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular]';
            }
            seen.add(value);
        }
        return value;
    };
};

scanDirectory(rootPath).then(flatAgents => {
    const hierarchicalResult = buildHierarchy(flatAgents);
    console.log(JSON.stringify(hierarchicalResult, circularReplacer(), 2));
});
*/