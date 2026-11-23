import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { CurrentUser, Public } from '../../common/decorators';
import { UsuarioActual } from '../../common/auth.types';
import { AuthService } from './auth.service';

class LoginDto {
  @IsEmail({}, { message: 'Ingrese un correo válido' }) email: string;
  @IsString() @MinLength(1) password: string;
}

class CambiarPasswordDto {
  @IsString() actual: string;
  @IsString() nueva: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: UsuarioActual) {
    return this.auth.me(user.id);
  }

  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(200)
  cambiarPassword(@CurrentUser() user: UsuarioActual, @Body() dto: CambiarPasswordDto) {
    return this.auth.cambiarPassword(user, dto.actual, dto.nueva);
  }
}
