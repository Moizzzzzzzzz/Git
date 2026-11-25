import { DEFAULT_TEMPLATE_CONTENT, DEV_DEFAULT_FOUR_POINT_RULES } from '@fabricqc/shared';
import { validateBusinessConfiguration } from './business-configuration';

describe('检验方案关联校验', () => {
  const standard={...DEV_DEFAULT_FOUR_POINT_RULES,applicability:{structure:['KNIT'],fiber:['POLYESTER','NYLON']},checklistPolicies:[{checklistKey:'color_match',onNg:'FAIL_ON_NG',onNa:'ALLOW',onMissing:'INCONCLUSIVE'}]};
  it('接受混纺交集和未标注旧方案', () => {
    expect(()=>validateBusinessConfiguration({...DEFAULT_TEMPLATE_CONTENT,applicability:{structure:['KNIT'],fiber:['NYLON']}},[standard])).not.toThrow();
    expect(()=>validateBusinessConfiguration(DEFAULT_TEMPLATE_CONTENT,[DEV_DEFAULT_FOUR_POINT_RULES])).not.toThrow();
  });
  it('拒绝无交集和不在模板的检查项', () => {
    expect(()=>validateBusinessConfiguration({...DEFAULT_TEMPLATE_CONTENT,applicability:{structure:['WOVEN'],fiber:['NYLON']}},[standard])).toThrow('不兼容');
    expect(()=>validateBusinessConfiguration({...DEFAULT_TEMPLATE_CONTENT,checklist:[]},[standard])).toThrow('不在检验模板');
  });
});
