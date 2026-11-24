import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({ imports: [DocumentsModule], controllers: [AttachmentsController], providers: [AttachmentsService] })
export class AttachmentsModule {}
