import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ListCliniciansQueryDto } from './dto/list-clinicians.query.dto';
import { ListCliniciansResponseDto } from './dto/list-clinicians.response.dto';
import { ListCliniciansService } from './list-clinicians.service';

@ApiTags('clinicians')
@Controller({ path: 'clinicians', version: '1' })
export class ListCliniciansController {
  constructor(private readonly listCliniciansService: ListCliniciansService) {}

  @Get()
  @Auth('clinician:list')
  @ApiOkResponse({ type: ListCliniciansResponseDto })
  @ApiOperation({
    operationId: 'clinicianList',
    summary: 'Admin: cursor-paginated directory of provisioned CLINICIAN users.',
  })
  list(@Query() query: ListCliniciansQueryDto): Promise<ListCliniciansResponseDto> {
    return this.listCliniciansService.list(query);
  }
}
