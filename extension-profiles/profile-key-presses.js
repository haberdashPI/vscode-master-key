import fs from 'fs';
import path from 'path';

// change these constants to adjust what we profile
const TARGET_FUNCTION_NAME = 'prefix'; // function name
const TARGET_PROFILES = 'master-key-prefix'; // file prefix
const PROFILES_DIR = '.';

const calleeStats = {}; // { calleeName: totalMs }
let totalFilesProcessed = 0;

function analyzeProfile(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const { nodes, samples, timeDeltas } = data;

    // 1. Map for easy lookups
    const nodeMap = new Map();
    nodes.forEach(n => nodeMap.set(n.id, n));

    // 2. Identify the target node(s)
    const targetNodeIds = nodes.
        filter(n => n.callFrame.functionName === TARGET_FUNCTION_NAME).
        map(n => n.id);

    if (targetNodeIds.length === 0) return;

    // 3. Build a Parent Map to walk UP the stack
    const parentMap = new Map();
    nodes.forEach((n) => {
        if (n.children) {
            n.children.forEach(childId => parentMap.set(childId, n.id));
        }
    });

    // 4. Process Samples
    samples.forEach((nodeId, i) => {
        const microSeconds = timeDeltas[i];
        let currentId = nodeId;
        let calleeName = null;

        // Walk up the stack from the current sample
        while (currentId !== undefined) {
            const parentId = parentMap.get(currentId);
            if (parentId === undefined) break;

            // If the parent is our target, the currentId is the DIRECT CALLEE
            if (targetNodeIds.includes(parentId)) {
                calleeName = nodeMap.get(currentId).callFrame.functionName || '(anonymous)';
                break;
            }
            currentId = parentId;
        }

        if (calleeName) {
            calleeStats[calleeName] = (calleeStats[calleeName] || 0) +
                (microSeconds / 1000);
        }
    });
    totalFilesProcessed++;
}

// Run through directory
console.log(`Analyzing callees of "${TARGET_FUNCTION_NAME}"...`);
fs.readdirSync(PROFILES_DIR).forEach((file) => {
    if (file.startsWith(TARGET_PROFILES)) {
        analyzeProfile(path.join(PROFILES_DIR, file));
    }
});

// Display results
const sorted = Object.entries(calleeStats).
    sort((a, b) => b[1] - a[1]).
    map(([name, ms]) => ({
        'Callee Name': name,
        'Total Time (ms)': ms.toFixed(3),
        'Avg per Profile (ms)': (ms / totalFilesProcessed).toFixed(3),
    }));

console.table(sorted);
