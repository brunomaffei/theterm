import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

type Dir =
  | 'North'
  | 'South'
  | 'East'
  | 'West'
  | 'NorthEast'
  | 'NorthWest'
  | 'SouthEast'
  | 'SouthWest';

const DIRECTIONS: Dir[] = [
  'North',
  'South',
  'East',
  'West',
  'NorthWest',
  'NorthEast',
  'SouthWest',
  'SouthEast',
];

/**
 * Invisible edge/corner strips that drive native window resizing for the
 * frameless window (decorations are off, so the OS borders are gone).
 */
export default function ResizeHandles(): JSX.Element {
  return (
    <>
      {DIRECTIONS.map((dir) => (
        <div
          key={dir}
          className={`resize-handle resize-handle--${dir.toLowerCase()}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void appWindow.startResizeDragging(dir);
          }}
        />
      ))}
    </>
  );
}
