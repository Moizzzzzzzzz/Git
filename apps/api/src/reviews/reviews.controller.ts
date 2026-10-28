import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { reviewDecisionSchema } from '@fabricqc/shared';
import type { z } from 'zod';
import { CurrentActor, ReqMeta, type RequestMeta, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import { REVIEWERS, type Actor } from '../common/actor';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
@Roles(...REVIEWERS)
export class ReviewsController {
  constructor(private readonly svc: ReviewsService) {}

  @Get('pending')
  pending(@CurrentActor() a: Actor) {
    return this.svc.myPending(a);
  }

  @Get('queue')
  queue(@CurrentActor() a: Actor) {
    return this.svc.queue(a);
  }

  @Post(':inspectionId/decide')
  @HttpCode(200)
  decide(
    @CurrentActor() a: Actor,
    @Param('inspectionId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(zod(reviewDecisionSchema)) b: z.infer<typeof reviewDecisionSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.decide(a, id, b, m);
  }
}
