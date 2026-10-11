import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateExpertDto {
  @ApiProperty({ example: 'Priya Nair', minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'priya.nair@expert.example' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'a-strong-passphrase',
    minLength: 10,
    maxLength: 128,
    description: 'Initial password, set by the admin and shared with the expert directly.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;
}
