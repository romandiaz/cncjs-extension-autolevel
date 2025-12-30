module.exports = {
  apps: [
    {
      name: "cncjs-kt-autolevel",
      script: ".",
      args: "--port /dev/ttyUSB0 --baudrate 115200"
    }
  ]
}
