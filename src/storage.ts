import fs from 'fs';
import path from 'path';
import { AvailableSlot, NotifiedState } from './types';

const DEFAULT_STATE: NotifiedState = {
  notifiedIds: [],
  lastChecked: new Date(0).toISOString(),
};

export function readState(filePath: string): NotifiedState {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as NotifiedState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeState(filePath: string, state: NotifiedState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

export function getNewSlots(
  current: AvailableSlot[],
  state: NotifiedState
): AvailableSlot[] {
  const notifiedSet = new Set(state.notifiedIds);
  return current.filter(slot => !notifiedSet.has(slot.slotId));
}

export function buildNextState(
  prev: NotifiedState,
  newSlots: AvailableSlot[]
): NotifiedState {
  const merged = new Set([
    ...prev.notifiedIds,
    ...newSlots.map(s => s.slotId),
  ]);
  return {
    notifiedIds: [...merged],
    lastChecked: new Date().toISOString(),
  };
}
