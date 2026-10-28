import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RoleCode, uploadIntentSchema } from '@fabricqc/shared';
import type { z } from 'zod';
import { CurrentActor, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import type { Actor } from '../common/actor';
import { MediaService } from './media.service';

@Controller('media')
@Roles(RoleCode.INSPECTOR)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('upload-intents')
  intent(@CurrentActor() a: Actor, @Body(zod(uploadIntentSchema)) b: z.infer<typeof uploadIntentSchema>) {
    return this.media.createUploadIntent(a, b);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.media.confirm(a, id);
  }
}
