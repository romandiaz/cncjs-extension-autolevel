const Autolevel = require('./autolevel');
const Mesh = require('./mesh');

// Mock socket
const mockSocket = {
    on: (event, callback) => { },
    emit: (event, ...args) => { },
    sendGcode: (gcode) => { }
};

const options = {
    port: 'COM1',
    outDir: null
};

const autolevel = new Autolevel(mockSocket, options);

// Mock sckw
autolevel.sckw = {
    sendMessage: (msg) => console.log('MSG:', msg),
    sendGcode: (msg) => console.log('GCODE:', msg),
    loadGcode: (name, content) => {
        console.log('--- GENERATED GCODE ---');
        console.log(content);
        console.log('--- END GCODE ---');
    }
};

// Initialize a dummy mesh
// 10x10 grid, all Z=0 (flat) just to check subdivision
let points = [];
for (let x = 0; x <= 100; x += 10) {
    for (let y = 0; y <= 10; y += 10) {
        points.push({ x, y, z: 0 });
    }
}
autolevel.probedPoints = points;
autolevel.delta = 10; // Grid spacing

// Test G-code with long first move
autolevel.gcode = `G0 X100 Y0 Z10`;

console.log("Running applyCompensation...");
autolevel.applyCompensation();
