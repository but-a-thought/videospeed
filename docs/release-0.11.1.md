# Release 0.11.1

## Fixes

- Restored Bilibili scroll-to-volume without changing VSC's controller-local wheel speed controls (#1598, #1610).
- Preserved remembered speed when seeking or media initialization resets playback to `1x`, while keeping deliberate native “Normal” choices valid (#1600).
- Preserved granular VSC rates on players that immediately clamp speed changes, while keeping ordinary VSC changes visible to player controls and auxiliary media (#1606).
