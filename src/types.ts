export type Tool = 'select' | 'wall' | 'rect' | 'scale' | 'dimension' | 'probe';

export interface Point {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  points: number[]; // [x1, y1, x2, y2]
  thickness: number;
  height: number;
  color: string;
}

export interface Scale {
  ratioX: number; // pixels per unit
  ratioY: number; // pixels per unit
  unit: 'm' | 'ft';
}

export interface Dimension {
  id: string;
  points: number[]; // [x1, y1, x2, y2]
  color: string;
}

export interface Measurement {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  cost?: number;
}
