// Quick script to create a minimal tray icon PNG
// This creates a 16x16 blue circle PNG
import { writeFileSync } from 'fs';

// Minimal 16x16 PNG with a blue circle — pre-encoded
// We'll just use the inline base64 in main process instead
console.log('Tray icon handled inline in main process');
