const fs = require('fs');
const path = require('path');

const DEFAULT_PROBE_FILE = path.join(__dirname, '../../__last_Z_probe.txt');

console.log('__dirname:', __dirname);
console.log('Calculated Probe File Path:', DEFAULT_PROBE_FILE);

try {
    if (fs.existsSync(DEFAULT_PROBE_FILE)) {
        console.log('File exists.');
        const data = fs.readFileSync(DEFAULT_PROBE_FILE, 'utf8');
        console.log('File Content Length:', data.length);

        let lines = data.split('\n');
        let points = 0;
        lines.forEach((line, idx) => {
            if (idx < 5) console.log(`Line ${idx}: ${line}`);
            let vals = line.split(' ');
            if (vals.length >= 3) {
                points++;
            }
        });
        console.log(`Parsed ${points} points.`);
    } else {
        console.log('File does NOT exist.');
    }
} catch (err) {
    console.error('Error reading file:', err);
}
