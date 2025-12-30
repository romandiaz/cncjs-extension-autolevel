# CNCjs Autolevel Extension and Widget

This project provides auto-leveling capabilities for CNCjs, primarily designed for PCB isolation milling. It consists of two parts:
1.  **Extension**: A backend service that interfaces with CNCjs to handle probing and G-code modification.
2.  **Widget**: A frontend UI for CNCjs that provides a user-friendly interface for controlling the extension and visualizing the surface map.

## Project Structure

*   `src/extension/`: The backend Node.js extension.
*   `src/widget/`: The frontend widget source code (HTML/JS/CSS).

---

## 1. Extension Setup

The extension runs as a separate process that connects to the CNCjs server.

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/kreso-t/cncjs-kt-ext.git
    cd cncjs-kt-ext
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

### Running the Extension

Start the extension by running:

```bash
node src/extension/index.js [options]
```

**Common Examples:**

*   **Standard Run** (Connects to default port `/dev/ttyACM0`):
    ```bash
    node src/extension/index.js
    ```
*   **Specific Port** (e.g., Windows COM port or Linux device):
    ```bash
    node src/extension/index.js --port COM3
    # OR
    node src/extension/index.js --port /dev/ttyUSB0
    ```

### Command Line Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `-p, --port <port>` | Serial port path or name | `/dev/ttyACM0` |
| `-b, --baudrate <baud>`| Baud rate | `115200` |
| `--socket-address <addr>` | Socket address or hostname | `localhost` |
| `--socket-port <port>` | Socket port | `8000` |
| `--controller-type` | Controller type (Grbl, Smoothie, TinyG) | `Grbl` |
| `-s, --secret <secret>` | CNCjs secret key (reads from `~/.cncrc` if omitted) | |
| `-i, --id <id>` | User ID (reads from `~/.cncrc` if omitted) | |

### Running with PM2 (Recommended for Production)

If you use PM2 to manage CNCjs, you can also use it for this extension:

1.  Copy the example config:
    ```bash
    cp pm2.example.config.js pm2.config.js
    ```
2.  Edit `pm2.config.js` to match your system (e.g., correct `script` path, `args` for port).
3.  Start and save:
    ```bash
    pm2 start pm2.config.js
    pm2 save
    ```

---

## 2. Widget Setup

The widget provides the graphical interface inside CNCjs.

### Installation in CNCjs

There are two primary ways to load the widget into CNCjs: **mounting** (local) or **serving** (remote/network).

#### Option A: Mounting (Recommended for Local Use)

You can mount the `src/widget` directory directly into CNCjs using the `--mount` argument. This requires restarting your CNCjs server with the added flag.

```bash
cncjs --mount /widget:/path/to/cncjs-kt-ext/src/widget
```
*Replace `/path/to/...` with the actual absolute path to the repo on your machine.*

#### Option B: Serving (For Remote Access)

If you cannot easily modify the CNCjs start commands, you can serve the widget files using a simple HTTP server and point CNCjs to it.

1.  navigate to the widget directory:
    ```bash
    cd src/widget
    ```
2.  Start a simple HTTP server (requires Python or `http-server` npm package):
    ```bash
    # Python 3
    python -m http.server 8080 --bind 0.0.0.0
    
    # OR using Node.js
    npx http-server . -p 8080 --cors
    ```
3.  In CNCjs, look for the "Manage Widgets" (or "Shop Floor Tablet") section and add a custom widget pointing to `http://<your-ip>:8080/index.html`.

---

## 3. Usage

### Widget Interface

Once the widget is loaded in CNCjs:

1.  **Status**: Ensure the widget shows "Connected" (or similar status indicating it sees the extension).
2.  **Settings**:
    *   **Leveling**: Set Probe Feedrate, Touch Plate Height, Margin, and Grid Size (X/Y step).
    *   **Skew**: Configure skew detection settings if needed.
3.  **Probing**:
    *   **Initiate Surface Map**: Starts the probing process based on your loaded G-code or manual bounds.
    *   **Measure Skew**: Probes two points to calculate and compensate for workpiece rotation.
4.  **Visualizer**:
    *   Displays a real-time heightmap of the probed PCB surface.
    *   **Apply Mesh**: Modifies the currently loaded G-code with the mesh data.

### Macros & Commands

You can also control the extension via G-code macros or the console.

| Command | Description |
| :--- | :--- |
| `(#autolevel)` | Probes the area defined by the loaded G-code bounds. |
| `(#autolevel D[dist] H[ht] F[feed])` | Probes with custom **D**istance (grid step), **H**eight (retract), **F**eedrate. |
| `(#autolevel GRID[points] X[xSize] Y[ySize])` | Probes by dividing the area into a specific number of `GRID` points (e.g., `GRID3` = 3x3 grid). Overrides Distance `D`. |
| `(#autolevel_reapply)` | Re-applies the *previously* probed mesh to the currently loaded G-code (useful if you reload the file). |
| `(#autolevel_get_mesh)` | Requests the current mesh data (used by the Visualizer to sync state). |
| `(PROBEOPEN filename)` | Save probe results to a specific file. |
| `(PROBECLOSE)` | Close the probe file (invoked automatically by `#autolevel`). |

**Example Macro:**
```gcode
; Probe every 10mm, retract 2mm, feedrate 50
(#autolevel D10 H2 F50)

; Probe 5x5 points over the loaded G-code area
(#autolevel GRID5)
```

## Troubleshooting

*   **"Socket Disconnected"**: Ensure the extension process (`node src/extension/index.js`) is running and has not crashed.
*   **Permissions**: On Linux, ensure the user running the extension has access to the serial port (usually `dialout` group).
*   **Widget not loading**: Check the browser console (F12) for 404 errors. Verify the mount path or HTTP server URL.
