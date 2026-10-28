import { Module } from '@nestjs/common';
import { DepartmentsController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({ controllers: [DepartmentsController, UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
