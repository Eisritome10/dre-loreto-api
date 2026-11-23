import { RolUsuario } from '@prisma/client';

/** Usuario autenticado que Passport deja en `req.user`. Es clase para poder usarla en firmas decoradas. */
export class UsuarioActual {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  rol: RolUsuario;
  areaId: string | null;
  debeCambiarPassword: boolean;
}
