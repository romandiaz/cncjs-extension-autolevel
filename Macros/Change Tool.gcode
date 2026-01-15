G21 ; Metric

; User-defined variables (***METRIC***)
%SAFE_HEIGHT = 0; Height needed to clear everything (negative number, distance below Z limit)
%TOOL_PROBE_X = 618.5 ; Machine coords
%TOOL_PROBE_Y = 25 ; Machine coords
%TOOL_PROBE_Z = 0   ; Machine coords
%PROBE_DISTANCE = 50
%PROBE_FAST_FEEDRATE = 150 ; mm/min
%PROBE_SLOW_FEEDRATE = 25 ; mm/min
%TRAVEL_SPEED = 500 ; mm/min
%H_TRAVEL_SPEED = 5000 ; mm/min
; Keep a backup of current work position
%X0=posx, Y0=posy, Z0=posz

M5; Stop spindle

G90
G53 Z[SAFE_HEIGHT] F[TRAVEL_SPEED]
G53 X[TOOL_PROBE_X] Y[TOOL_PROBE_Y] F[H_TRAVEL_SPEED]


; Set up for probing
M0 (Make sure probe is there);

G53 Z[TOOL_PROBE_Z] F[TRAVEL_SPEED]
G91
G38.2 Z-[PROBE_DISTANCE] F[PROBE_FAST_FEEDRATE]
G0 Z1
G38.2 Z-2 F[PROBE_SLOW_FEEDRATE]

G90
%wait
G4 P0  ; work around cncjs sending 1 command ahead

%ORIGINAL_TOOL = posz

G91
G0 Z5
G90
G53 Z[SAFE_HEIGHT] F[TRAVEL_SPEED];

; Manual tool change & probing
M0 (Change tool now);

;G53 Z[TOOL_PROBE_Z]
G91
G38.2 Z-[PROBE_DISTANCE] F[PROBE_FAST_FEEDRATE]
G0 Z1
G38.2 Z-2 F[PROBE_SLOW_FEEDRATE]

G90
%wait
G4 P0  ; work around cncjs sending 1 command ahead

; Update Z offset for new tool to be that of original tool
G92 Z[ORIGINAL_TOOL]

G91
G0 Z5
G90
G53 Z[SAFE_HEIGHT] F[TRAVEL_SPEED];

; Cleanup (e.g. remove touch plate, wires, etc)

; Go to previous work position
G0 X[X0] Y[Y0] F[H_TRAVEL_SPEED]


G0 F[TRAVEL_SPEED];