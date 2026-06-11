import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  readState,
  writeState,
  getNewSlots,
  buildNextState,
} from '../src/storage';
import { AvailableSlot, NotifiedState } from '../src/types';

describe('readState', () => {
  it('ファイルが存在しないときデフォルト状態を返す', () => {
    const result = readState('/nonexistent/path.json');
    expect(result.notifiedIds).toEqual([]);
    expect(result.lastChecked).toBeDefined();
  });

  it('正常なJSONファイルから状態を読み込む', () => {
    const tmpFile = path.join(os.tmpdir(), 'test-state.json');
    const state: NotifiedState = {
      notifiedIds: ['2026-06-26T10:00'],
      lastChecked: '2026-06-01T00:00:00Z',
    };
    fs.writeFileSync(tmpFile, JSON.stringify(state));
    const result = readState(tmpFile);
    expect(result.notifiedIds).toEqual(['2026-06-26T10:00']);
    fs.unlinkSync(tmpFile);
  });
});

describe('writeState', () => {
  it('状態をJSONファイルに書き込む', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoichi-'));
    const filePath = path.join(tmpDir, 'state.json');
    const state: NotifiedState = {
      notifiedIds: ['2026-06-26T09:00'],
      lastChecked: '2026-06-11T00:00:00Z',
    };
    writeState(filePath, state);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(raw.notifiedIds).toEqual(['2026-06-26T09:00']);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('ディレクトリが存在しない場合も書き込める', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoichi-'));
    const filePath = path.join(tmpDir, 'nested', 'state.json');
    writeState(filePath, { notifiedIds: [], lastChecked: '' });
    expect(fs.existsSync(filePath)).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('getNewSlots', () => {
  const slots: AvailableSlot[] = [
    { date: '2026-06-26', time: '09:00', remaining: 5, slotId: '2026-06-26T09:00' },
    { date: '2026-06-26', time: '10:00', remaining: 2, slotId: '2026-06-26T10:00' },
    { date: '2026-06-26', time: '11:00', remaining: 8, slotId: '2026-06-26T11:00' },
  ];

  it('すべて新規のとき全スロットを返す', () => {
    const state: NotifiedState = { notifiedIds: [], lastChecked: '' };
    expect(getNewSlots(slots, state)).toHaveLength(3);
  });

  it('既通知済みのスロットを除外する', () => {
    const state: NotifiedState = {
      notifiedIds: ['2026-06-26T09:00', '2026-06-26T11:00'],
      lastChecked: '',
    };
    const result = getNewSlots(slots, state);
    expect(result).toHaveLength(1);
    expect(result[0].slotId).toBe('2026-06-26T10:00');
  });

  it('すべて通知済みのとき空配列を返す', () => {
    const state: NotifiedState = {
      notifiedIds: ['2026-06-26T09:00', '2026-06-26T10:00', '2026-06-26T11:00'],
      lastChecked: '',
    };
    expect(getNewSlots(slots, state)).toHaveLength(0);
  });
});

describe('buildNextState', () => {
  it('新規スロットの ID を既存の通知済みリストにマージする', () => {
    const prev: NotifiedState = {
      notifiedIds: ['2026-06-26T09:00'],
      lastChecked: '',
    };
    const newSlots: AvailableSlot[] = [
      { date: '2026-06-26', time: '10:00', remaining: 2, slotId: '2026-06-26T10:00' },
    ];
    const next = buildNextState(prev, newSlots);
    expect(next.notifiedIds).toContain('2026-06-26T09:00');
    expect(next.notifiedIds).toContain('2026-06-26T10:00');
    expect(next.notifiedIds).toHaveLength(2);
  });

  it('重複した ID を持ち込まない', () => {
    const prev: NotifiedState = {
      notifiedIds: ['2026-06-26T09:00'],
      lastChecked: '',
    };
    const newSlots: AvailableSlot[] = [
      { date: '2026-06-26', time: '09:00', remaining: null, slotId: '2026-06-26T09:00' },
    ];
    const next = buildNextState(prev, newSlots);
    expect(next.notifiedIds).toHaveLength(1);
  });

  it('lastChecked を更新する', () => {
    const before = new Date();
    const next = buildNextState({ notifiedIds: [], lastChecked: '' }, []);
    const after = new Date();
    const ts = new Date(next.lastChecked);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
