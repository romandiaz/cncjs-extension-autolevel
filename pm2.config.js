module.exports = {
    apps: [
        {
            name: "cncjs-autolevel",
            script: "src/extension/index.js",
            // Edit these arguments to match your setup:
            // --port /dev/ttyACM0 (Linux) or COM3 (Windows)
            // args: "--port /dev/ttyUSB0 --baudrate 115200"
        }
    ]
}
