import { formatearNumero, hoyLima, parseFecha, semaforo, sumarDias } from './documents.util';

describe('documents.util', () => {
  it('formatea el número oficial con ceros, año y sigla del área', () => {
    expect(formatearNumero('OFICIO (M)', 7, 2026, 'GRL-GGR-GREL-DGP')).toBe('OFICIO (M) N° 007-2026-GRL-GGR-GREL-DGP');
  });

  it('parsea fechas ISO a medianoche UTC', () => {
    expect(parseFecha('2026-01-06').toISOString()).toBe('2026-01-06T00:00:00.000Z');
  });

  it('semáforo: sin plazo, en plazo, por vencer y vencido', () => {
    const hoy = hoyLima();
    expect(semaforo(null, 'PENDIENTE')).toBe('SIN_PLAZO');
    expect(semaforo(sumarDias(hoy, 5), 'PENDIENTE')).toBe('EN_PLAZO');
    expect(semaforo(sumarDias(hoy, 1), 'RECIBIDA')).toBe('POR_VENCER');
    expect(semaforo(sumarDias(hoy, -1), 'PENDIENTE')).toBe('VENCIDO');
  });

  it('una derivación atendida ya no tiene semáforo', () => {
    expect(semaforo(sumarDias(hoyLima(), -9), 'ATENDIDA')).toBe('SIN_PLAZO');
  });
});
