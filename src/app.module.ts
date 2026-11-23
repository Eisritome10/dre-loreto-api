import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AreasModule } from './modules/areas/areas.module';
import { DocumentTypesModule } from './modules/document-types/document-types.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PublicModule } from './modules/public/public.module';
import { JwtAuthGuard, RolesGuard } from './common/guards';

function validateEnv(env: Record<string, unknown>) {
  const missing = ['DATABASE_URL', 'JWT_SECRET'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  if (String(env.JWT_SECRET).length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
  return env;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    AreasModule,
    DocumentTypesModule,
    DocumentsModule,
    DashboardModule,
    PublicModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
