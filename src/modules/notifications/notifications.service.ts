import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export type EventoTramite = 'REGISTRADO' | 'DERIVADO' | 'ATENDIDO' | 'LISTO';

export interface DatosTramite {
  correoContacto: string | null;
  codigoSeguimiento: string | null;
  numeroDocumento: string | null;
  numeroRegistro: number;
  tipoDocumento: { nombre: string };
  area: { nombre: string };
}

/**
 * Avisos por correo al usuario externo que dejó su contacto. Nunca incluyen remitente ni asunto:
 * solo el estado y el código para consultar. Si no hay servidor de correo configurado, se omiten.
 * Un fallo al enviar jamás debe impedir el trámite, por eso se registra y se continúa.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);
  private readonly transporte: nodemailer.Transporter | null;
  private readonly desde: string;
  private readonly urlConsulta: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('MAIL_HOST');
    this.desde = config.get<string>('MAIL_FROM') ?? 'Trámite Documentario DRE Loreto <no-responder@drel.local>';
    this.urlConsulta = config.get<string>('PUBLIC_CONSULTA_URL') ?? 'http://localhost:8080/consulta';
    this.transporte = host
      ? nodemailer.createTransport({
          host,
          port: Number(config.get('MAIL_PORT') ?? 1025),
          secure: config.get('MAIL_SECURE') === 'true',
          auth: config.get('MAIL_USER') ? { user: config.get<string>('MAIL_USER'), pass: config.get<string>('MAIL_PASS') } : undefined,
        })
      : null;
    if (!this.transporte) this.log.warn('MAIL_HOST no configurado: no se enviarán avisos por correo.');
  }

  /** Dispara el aviso sin esperar el resultado. */
  tramite(evento: EventoTramite, d: DatosTramite) {
    if (!d.correoContacto || !this.transporte) return;
    const ref = d.numeroDocumento ?? `${d.tipoDocumento.nombre} N° ${d.numeroRegistro}`;
    const enlace = d.codigoSeguimiento ? `${this.urlConsulta}?codigo=${d.codigoSeguimiento}` : this.urlConsulta;
    const mensajes: Record<EventoTramite, { asunto: string; texto: string }> = {
      REGISTRADO: {
        asunto: 'Recibimos su trámite',
        texto: `Registramos su trámite (${ref}) en ${d.area.nombre}.`,
      },
      DERIVADO: {
        asunto: 'Su trámite está en atención',
        texto: `Su trámite (${ref}) fue derivado para su atención en ${d.area.nombre}.`,
      },
      ATENDIDO: {
        asunto: 'Su trámite fue atendido',
        texto: `Su trámite (${ref}) ya fue atendido.`,
      },
      LISTO: {
        asunto: 'Su documento está listo para recoger',
        texto: `Su documento (${ref}) está listo. Puede recogerlo en ${d.area.nombre}, presentando su cargo de recepción.`,
      },
    };
    const m = mensajes[evento];
    const cuerpo = [
      m.texto,
      d.codigoSeguimiento ? `Código de seguimiento: ${d.codigoSeguimiento}` : '',
      `Consulte el estado en cualquier momento: ${enlace}`,
      'Este mensaje es automático; no responda a este correo.',
    ].filter(Boolean);
    this.transporte
      .sendMail({
        from: this.desde,
        to: d.correoContacto,
        subject: `${m.asunto} · DRE Loreto`,
        text: cuerpo.join('\n\n'),
        html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:16px;line-height:1.5;color:#211c1c;max-width:36rem">
          <h2 style="color:#8b1e2d;margin:0 0 .75rem">${m.asunto}</h2>
          <p>${m.texto}</p>
          ${d.codigoSeguimiento ? `<p>Código de seguimiento: <strong style="font-size:1.2em;letter-spacing:.08em">${d.codigoSeguimiento}</strong></p>` : ''}
          <p><a href="${enlace}" style="display:inline-block;background:#8b1e2d;color:#fff;padding:.6rem 1.1rem;border-radius:8px;text-decoration:none;font-weight:600">Ver el estado de mi trámite</a></p>
          <p style="color:#655c5c;font-size:.85rem">Este mensaje es automático; no responda a este correo.<br>Dirección Regional de Educación de Loreto</p></div>`,
      })
      .catch((e: Error) => this.log.warn(`No se pudo enviar el aviso (${evento}): ${e.message}`));
  }
}
