# CNCjs Autolevel Extension

The **CNCjs Autolevel Extension** provides advanced auto-leveling and PCB correction capabilities for CNCjs. Designed primarily for PCB isolation milling, it combines a backend extension with a rich frontend widget to helps you achieve perfect engraving depths on uneven surfaces.

## Key Features

### 1. Surface Mapping (Auto-Leveling)
Automatically probe your PCB surface to create a detailed height map. The extension uses **bicubic interpolation** to generate a smooth, high-resolution mesh from your probe points. This mesh is applied to your G-code in real-time or saved for later use, ensuring that your tool follows the exact contours of the material.

### 2. Skew Compensation
No need to align your PCB perfectly parallel to the axis. The **Skew Compensation** feature allows you to probe two points on the board to calculate its rotation. The extension then automatically rotates your G-code commands to match the workpiece, simplifying setup.

### 3. Interactive Visualizer
A real-time 3D visualizer displays the probed surface topology, giving you immediate feedback on the board's flatness. It also shows the tool path relative to the mesh, so you can verify corrections before cutting.

### 4. Probing Sequences
The **Probing Tab** contains buttons that initiate advanced probing sequences and procedures to set the zero point for your stock.

### 5. Configuration Settings
The **Configuration menu** allows you to fine-tune the probing behavior. You can adjust the feed rates for the probing sequences, set the height of the touch plate (if using one), and define the safe Z height for the probing sequences.

---

## Installation

### 1. Extension (Backend)
The extension runs as a separate Node.js process that communicates with CNCjs.

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/romandiaz/cncjs-extension-autolevel
    cd cncjs-extension-autolevel
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Start the extension (using PM2)**:
    It is recommended to use PM2 to manage the extension process alongside CNCjs.

    1.  Edit `pm2.example.config.js` to match your ecosystem (e.g., update the `script` path or add `--port` args).

    2.  Copy/rename the example config:
        ```bash
        cp pm2.example.config.js pm2.config.js
        ```

    3.  Start the process:
        ```bash
        pm2 start pm2.config.js
        pm2 save
        ```

### 2. Widget (Frontend)
The widget must be loaded into the CNCjs interface. You can either **mount** it (local) or **serve** it (network).

#### Option A: Using PM2 (Recommended for Local Use)
```bash
pm2 start $(which cncjs) -- --port 8000 -m /widget:/home/pi/cncjs-extension-autolevel/src/widget
```
*Run 'pm2 delete cncjs' first, if you have already set up cncjs with pm2*

#### Option B: Mounting TO CNCjs
Restart CNCjs with the `--mount` flag:
```bash
cncjs --mount /widget:/home/pi/cncjs-extension-autolevel/src/widget
```
*Replace `/home/pi/...` with the absolute path to the repository.*

#### Option C: Serving (Remote Access)
If you run CNCjs on a different machine (e.g., Raspberry Pi), serve the widget folder via HTTP:
```bash
cd src/widget
npx http-server . -p 8080 --cors
```
Then, in CNCjs **Manage Widgets**, add a custom widget pointing to `http://<device-ip>:8080/index.html`.

---

## Usage Workflow

Follow this typical workflow to mill a PCB with auto-leveling:

### 1. Preparation
1.  **Connect**: Open CNCjs and ensure the Autolevel widget shows "Connected".
2.  **Home**: Home your machine (`$H`).
3.  **Zero**: Jog to your workpiece origin (X/Y/Z) and zero the coordinates.
    > [!TIP]
    > **Pro Tip:** Use the probe to set your Initial Zero point for maximum accuracy.

### 2. Skew Correction (Optional)
If your board isn't perfectly straight:
1.  Go to the **Skew** section in the widget.
2.  Click **Measure Skew**.
    *   The machine will probe a point at your current location (P1).
    *   It will move along X by the *Probe Spacing* distance and probe again (P2).
3.  The detected angle will be displayed. You can now mill; all G-code will be rotated automatically.

### 3. Surface Mapping
1.  Load your G-code file into CNCjs.
2.  In the widget's **Autolevel** tab, verify the settings:
    *   **Grid**: Number of probe points (e.g., `3` for a 3x3 grid).
    *   **Height**: Retract height between probes.
3.  Click **Initiate Surface Map**.
    *   The extension calculates the bounding box of your G-code.
    *   It generates a grid of points and begins probing.
4.  Watch the **Visualizer** build the surface map in real-time.

### 4. Apply & Mill
1.  Once probing is complete, click **Apply Mesh**.
    *   This modifies the loaded G-code in memory, applying Z-offsets.
2.  Verify the path in the CNCjs 3D preview.
3.  Run your job!

---

## Configuration Settings

The **Settings** tab allows you to fine-tune the probing behavior.

| Setting | Description | Recommended |
| :--- | :--- | :--- |
| **Probe Feed** | Speed at which the Z-axis descends during the initial search. | `50 - 200` mm/min |
| **Probe Slow Feed** | Slower speed for the second, precise touch. | `10 - 50` mm/min |
| **Touch Plate Height** | Thickness of your touch plate (if using one). Set to `0` for direct PCB probing. | `0` (PCB) or `15` (Block) |
| **Retract Dist** | Distance to pull back after a probe trigger. | `2 - 5` mm |
| **Safe Z** | Absolute Z height for rapid moves between points. | `5 - 20` mm |
| **Max Depth** | Maximum distance to search for the surface before alarming. | `10` mm |
| **Probe Spacing** | X-distance between points for Skew detection. | `50` mm |
| **Margin** | Extra boundary added within the G-code bounding box for the mesh grid. **Be aware** that gcode can extend beyond the bounds of the stock, requiring a larger margin. | `2 - 10` mm |

---

## Troubleshooting

*   **"Socket Disconnected"**: The widget cannot talk to the extension. Check if the `node src/extension/index.js` process is running.
*   **Probing stops/fails**: Ensure your probe wires are secure and the electrical connection is good. Check console logs for "Alarm" states.
*   **Visualizer empty**: Click "Probe New Mesh" or refresh the page to re-sync the mesh data from the server.
*   **Permissions (Linux)**: Ensure your user is in the `dialout` group to access serial ports.

---

## Macros
Advanced users can control the extension via G-code commands. These can be entered directly into the CNCjs Console or saved as **Custom Macros** in the CNCjs interface for one-click access:
*   `(#autolevel)`: Start probing based on loaded G-code.
*   `(#autolevel_skew)`: Initiate skew probing.
*   `(#autolevel_apply_mesh)`: Apply the current mesh to the loaded file.
*   `(#autolevel_active_off)`: Disable all corrections.
