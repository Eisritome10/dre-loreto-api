import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: (config.get<string>('CORS_ORIGIN') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('DRE Loreto - Trámite Documentario')
    .setDescription('API del sistema de trámite documentario (RSO: transformación digital inclusiva)')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(Number(config.get('PORT') ?? 3000));
}
bootstrap();
