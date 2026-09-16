import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ProductionProjectModule } from 'src/modules/production-project/production-project.module';
import { ProductionPlanModule } from 'src/modules/production-plan/production-plan.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    ProductionProjectModule,
    ProductionPlanModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
