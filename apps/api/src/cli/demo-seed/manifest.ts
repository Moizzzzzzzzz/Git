/** Fixed synthetic identities, used only after isolated environment verification. */
const SALES_1 = 'fe31afc0-ad98-41a5-9b2e-e22325e58907';
const SALES_2 = '47596d40-dd4a-4ca8-ab14-28e96be0489d';
const QC = 'e94e36a9-c71e-4958-afcc-df05d93545d5';
export const DEMO_DEPARTMENTS = [
  { id: SALES_1, code: 'DEMO-SALES-01', name: '演示销售一部' },
  { id: SALES_2, code: 'DEMO-SALES-02', name: '演示销售二部' },
  { id: QC, code: 'DEMO-QC', name: '演示质检部' },
] as const;
export const DEMO_PERSONAS = [
  { personaId:'p01', id:'13943a7e-f52a-4824-984c-1771fefbd6a4', employeeNo:'DEMO-SALES', name:'演示业务员', role:'SALES', departmentId:SALES_2, roleDepartmentId:SALES_2 },
  { personaId:'p02', id:'981dae6a-cea6-40e6-afa3-8cca4f9b0ba3', employeeNo:'DEMO-MANAGER', name:'演示部门经理', role:'BUSINESS_MANAGER', departmentId:SALES_2, roleDepartmentId:SALES_2 },
  { personaId:'p03', id:'0eef16ed-7a06-43a0-b4cf-475dbed6f72a', employeeNo:'DEMO-CLERK', name:'演示内勤', role:'BUSINESS_CLERK', departmentId:SALES_2, roleDepartmentId:SALES_2 },
  { personaId:'p04', id:'68e477eb-6dcb-4f1a-a992-61957a641027', employeeNo:'DEMO-QC-SUP', name:'演示质检主管', role:'QC_SUPERVISOR', departmentId:QC, roleDepartmentId:QC },
  { personaId:'p05', id:'83d6e219-1a9e-4fc9-b034-5ac89b2b3234', employeeNo:'DEMO-QC-INS', name:'演示质检跟单员', role:'INSPECTOR', departmentId:QC, roleDepartmentId:QC },
  { personaId:'p06', id:'ff46e22d-0f3b-464c-b8dc-864f968b310c', employeeNo:'DEMO-QUALITY-MGR', name:'演示质量经理', role:'QUALITY_MANAGER', departmentId:QC, roleDepartmentId:null },
  { personaId:'p07', id:'97c04bb3-866f-4fb0-9ce8-4718a4a26549', employeeNo:'DEMO-ADMIN', name:'演示系统管理员', role:'ADMIN', departmentId:null, roleDepartmentId:null },
] as const;
export const DEMO_FIXTURE_KEYS = ['UNASSIGNED','INPROGRESS','PENDING_REVIEW','RETURNED','FINAL_PENDING','DELIVERED_PASS','DELIVERED_FAIL','OTHER_DEPT'] as const;

export const DEMO_TEMPLATES = [
  {
    "code": "DEMO_TEMPLATE_KNIT_V1",
    "name": "DEMO TEST 针织模板【测试未正式批准】",
    "description": "功能测试专用；不用于正式验收",
    "content": {
      "applicability": {
        "structure": [
          "KNIT"
        ],
        "fiber": [
          "POLYESTER",
          "NYLON"
        ]
      },
      "checklist": [
        {
          "key": "label_match",
          "label": "测试：标签与卷信息一致",
          "required": true
        },
        {
          "key": "color_match",
          "label": "测试：外观对色需复核",
          "required": false
        },
        {
          "key": "hand_feel",
          "label": "测试：手感仅记录",
          "required": false
        },
        {
          "key": "edge_quality",
          "label": "测试：布边状态",
          "required": false
        },
        {
          "key": "knit_surface",
          "label": "测试：针织表面/针路",
          "required": false
        }
      ],
      "measurements": [
        {
          "key": "width",
          "label": "测试：门幅",
          "unit": "cm",
          "required": true,
          "minReadings": 3,
          "specField": "widthCm"
        },
        {
          "key": "effective_width",
          "label": "测试：有效门幅",
          "unit": "cm",
          "required": true,
          "minReadings": 3,
          "specField": "cuttableWidthCm"
        },
        {
          "key": "gsm",
          "label": "测试：克重",
          "unit": "g/m²",
          "required": true,
          "minReadings": 1,
          "specField": "gsm"
        },
        {
          "key": "roll_length",
          "label": "测试：卷长",
          "unit": "m",
          "required": true,
          "minReadings": 1,
          "specField": "nominalLengthM"
        },
        {
          "key": "skew_pct",
          "label": "测试：纬斜或歪斜百分比（选填）",
          "unit": "%",
          "required": false,
          "minReadings": 1
        }
      ],
      "photoCheckpoints": [
        {
          "key": "roll_label",
          "label": "测试：卷标",
          "required": true,
          "minPhotos": 1
        },
        {
          "key": "fabric_face",
          "label": "测试：布面",
          "required": true,
          "minPhotos": 1
        },
        {
          "key": "color_compare",
          "label": "测试：对色（选填）",
          "required": false,
          "minPhotos": 1
        }
      ]
    },
    "isActive": true
  },
  {
    "code": "DEMO_TEMPLATE_WOVEN_V1",
    "name": "DEMO TEST 梭织模板【测试未正式批准】",
    "description": "功能测试专用；不用于正式验收",
    "content": {
      "applicability": {
        "structure": [
          "WOVEN"
        ],
        "fiber": [
          "POLYESTER",
          "NYLON"
        ]
      },
      "checklist": [
        {
          "key": "label_match",
          "label": "测试：标签与卷信息一致",
          "required": true
        },
        {
          "key": "color_match",
          "label": "测试：外观对色需复核",
          "required": false
        },
        {
          "key": "hand_feel",
          "label": "测试：手感仅记录",
          "required": false
        },
        {
          "key": "edge_quality",
          "label": "测试：布边状态",
          "required": false
        },
        {
          "key": "woven_surface",
          "label": "测试：梭织经纬外观",
          "required": false
        }
      ],
      "measurements": [
        {
          "key": "width",
          "label": "测试：门幅",
          "unit": "cm",
          "required": true,
          "minReadings": 3,
          "specField": "widthCm"
        },
        {
          "key": "effective_width",
          "label": "测试：有效门幅",
          "unit": "cm",
          "required": true,
          "minReadings": 3,
          "specField": "cuttableWidthCm"
        },
        {
          "key": "gsm",
          "label": "测试：克重",
          "unit": "g/m²",
          "required": true,
          "minReadings": 1,
          "specField": "gsm"
        },
        {
          "key": "roll_length",
          "label": "测试：卷长",
          "unit": "m",
          "required": true,
          "minReadings": 1,
          "specField": "nominalLengthM"
        },
        {
          "key": "skew_pct",
          "label": "测试：纬斜或歪斜百分比（选填）",
          "unit": "%",
          "required": false,
          "minReadings": 1
        }
      ],
      "photoCheckpoints": [
        {
          "key": "roll_label",
          "label": "测试：卷标",
          "required": true,
          "minPhotos": 1
        },
        {
          "key": "fabric_face",
          "label": "测试：布面",
          "required": true,
          "minPhotos": 1
        },
        {
          "key": "color_compare",
          "label": "测试：对色（选填）",
          "required": false,
          "minPhotos": 1
        }
      ]
    },
    "isActive": true
  }
] as const;

export const DEMO_STANDARDS = [
  {
    "standard": {
      "code": "DEMO_FOUR_POINT_KNIT_V1",
      "name": "DEMO TEST 针织四分制【未正式批准】",
      "kind": "FOUR_POINT",
      "customerId": null,
      "description": "功能测试示例参数，非工厂或客户批准标准",
      "isActive": true
    },
    "version": {
      "purpose": "TEST",
      "notes": "TEST 功能测试专用；全部参数为测试假设，未经正式批准",
      "rules": {
        "schemaVersion": 1,
        "fourPoint": {
          "dimensionBasis": "MAX_DIMENSION",
          "bands": [
            {
              "maxCm": 7.62,
              "points": 1
            },
            {
              "maxCm": 15.24,
              "points": 2
            },
            {
              "maxCm": 22.86,
              "points": 3
            },
            {
              "maxCm": null,
              "points": 4
            }
          ],
          "specialRules": [
            {
              "mode": "BY_SIZE",
              "defectTypeCodes": [
                "HOLE"
              ],
              "bands": [
                {
                  "maxCm": 2.54,
                  "points": 2
                },
                {
                  "maxCm": null,
                  "points": 4
                }
              ],
              "note": "仅测试：复制原开发配置"
            },
            {
              "mode": "PER_LINEAR_UNIT",
              "defectTypeCodes": [
                "SHADING",
                "CONT_STREAK"
              ],
              "points": 4,
              "note": "仅测试：复制原开发配置"
            }
          ],
          "maxPointsPerLinearUnit": {
            "unitLengthM": 0.9144,
            "maxPoints": 4
          },
          "areaUnit": "PER_100_SQ_YD"
        },
        "thresholds": {
          "maxNormalizedPoints": 40
        },
        "forbiddenDefectTypes": [],
        "maxDefectCountByType": {},
        "failOnSeverity": "CRITICAL",
        "measurementLimits": [
          {
            "itemKey": "width",
            "label": "测试门幅",
            "mode": "RELATIVE_TO_SPEC",
            "specField": "widthCm",
            "minPct": -5,
            "maxPct": 5,
            "aggregate": "EACH",
            "required": true
          },
          {
            "itemKey": "effective_width",
            "label": "测试有效门幅",
            "mode": "RELATIVE_TO_SPEC",
            "specField": "cuttableWidthCm",
            "minPct": -5,
            "maxPct": 5,
            "aggregate": "EACH",
            "required": true
          },
          {
            "itemKey": "gsm",
            "label": "测试克重",
            "mode": "RELATIVE_TO_SPEC",
            "specField": "gsm",
            "minPct": -5,
            "maxPct": 5,
            "aggregate": "EACH",
            "required": true
          }
        ],
        "requiredScope": "FULL",
        "requireDefectPhoto": true,
        "applicability": {
          "structure": [
            "KNIT"
          ],
          "fiber": [
            "POLYESTER",
            "NYLON"
          ]
        },
        "checklistPolicies": [
          {
            "checklistKey": "label_match",
            "onNg": "FAIL_ON_NG",
            "onNa": "INCONCLUSIVE",
            "onMissing": "INCONCLUSIVE"
          },
          {
            "checklistKey": "color_match",
            "onNg": "REVIEW_ON_NG",
            "onNa": "INCONCLUSIVE",
            "onMissing": "INCONCLUSIVE"
          },
          {
            "checklistKey": "hand_feel",
            "onNg": "RECORD_ONLY",
            "onNa": "ALLOW",
            "onMissing": "ALLOW"
          },
          {
            "checklistKey": "edge_quality",
            "onNg": "REVIEW_ON_NG",
            "onNa": "ALLOW",
            "onMissing": "INCONCLUSIVE"
          },
          {
            "checklistKey": "knit_surface",
            "onNg": "REVIEW_ON_NG",
            "onNa": "INCONCLUSIVE",
            "onMissing": "INCONCLUSIVE"
          }
        ]
      }
    }
  },
  {
    "standard": {
      "code": "DEMO_FOUR_POINT_WOVEN_V1",
      "name": "DEMO TEST 梭织四分制【未正式批准】",
      "kind": "FOUR_POINT",
      "customerId": null,
      "description": "功能测试示例参数，非工厂或客户批准标准",
      "isActive": true
    },
    "version": {
      "purpose": "TEST",
      "notes": "TEST 功能测试专用；全部参数为测试假设，未经正式批准",
      "rules": {
        "schemaVersion": 1,
        "fourPoint": {
          "dimensionBasis": "MAX_DIMENSION",
          "bands": [
            {
              "maxCm": 7.62,
              "points": 1
            },
            {
              "maxCm": 15.24,
              "points": 2
            },
            {
              "maxCm": 22.86,
              "points": 3
            },
            {
              "maxCm": null,
              "points": 4
            }
          ],
          "specialRules": [
            {
              "mode": "BY_SIZE",
              "defectTypeCodes": [
                "HOLE"
              ],
              "bands": [
                {
                  "maxCm": 2.54,
                  "points": 2
                },
                {
                  "maxCm": null,
                  "points": 4
                }
              ],
              "note": "仅测试：复制原开发配置"
            },
            {
              "mode": "PER_LINEAR_UNIT",
              "defectTypeCodes": [
                "SHADING",
                "CONT_STREAK"
              ],
              "points": 4,
              "note": "仅测试：复制原开发配置"
            }
          ],
          "maxPointsPerLinearUnit": {
            "unitLengthM": 0.9144,
            "maxPoints": 4
          },
          "areaUnit": "PER_100_SQ_YD"
        },
        "thresholds": {
          "maxNormalizedPoints": 40
        },
        "forbiddenDefectTypes": [],
        "maxDefectCountByType": {},
        "failOnSeverity": "CRITICAL",
        "measurementLimits": [
          {
            "itemKey": "width",
            "label": "测试门幅",
            "mode": "RELATIVE_TO_SPEC",
            "specField": "widthCm",
            "minPct": -5,
            "maxPct": 5,
            "aggregate": "EACH",
            "required": true
          },
          {
            "itemKey": "effective_width",
            "label": "测试有效门幅",
            "mode": "RELATIVE_TO_SPEC",
            "specField": "cuttableWidthCm",
            "minPct": -5,
            "maxPct": 5,
            "aggregate": "EACH",
            "required": true
          },
          {
            "itemKey": "gsm",
            "label": "测试克重",
            "mode": "RELATIVE_TO_SPEC",
            "specField": "gsm",
            "minPct": -5,
            "maxPct": 5,
            "aggregate": "EACH",
            "required": true
          }
        ],
        "requiredScope": "FULL",
        "requireDefectPhoto": true,
        "applicability": {
          "structure": [
            "WOVEN"
          ],
          "fiber": [
            "POLYESTER",
            "NYLON"
          ]
        },
        "checklistPolicies": [
          {
            "checklistKey": "label_match",
            "onNg": "FAIL_ON_NG",
            "onNa": "INCONCLUSIVE",
            "onMissing": "INCONCLUSIVE"
          },
          {
            "checklistKey": "color_match",
            "onNg": "REVIEW_ON_NG",
            "onNa": "INCONCLUSIVE",
            "onMissing": "INCONCLUSIVE"
          },
          {
            "checklistKey": "hand_feel",
            "onNg": "RECORD_ONLY",
            "onNa": "ALLOW",
            "onMissing": "ALLOW"
          },
          {
            "checklistKey": "edge_quality",
            "onNg": "REVIEW_ON_NG",
            "onNa": "ALLOW",
            "onMissing": "INCONCLUSIVE"
          },
          {
            "checklistKey": "woven_surface",
            "onNg": "REVIEW_ON_NG",
            "onNa": "INCONCLUSIVE",
            "onMissing": "INCONCLUSIVE"
          }
        ]
      }
    }
  }
] as const;

export const DEMO_FABRICS = [
  {
    "testDimensions": {
      "structure": "KNIT",
      "fiber": "POLYESTER"
    },
    "body": {
      "code": "DEMO-KNIT_POLYESTER_V1",
      "nameZh": "DEMO TEST 针织涤纶合成样例【非实物】",
      "composition": "100% 涤纶（TEST 虚构）",
      "widthCm": 150,
      "cuttableWidthCm": 145,
      "gsm": 180,
      "weaveStructure": "针织（TEST）",
      "notes": "TEST合成资料；仅验证边界与流程，不代表真实面料",
      "isActive": true
    },
    "expectedTemplateCode": "DEMO_TEMPLATE_KNIT_V1",
    "expectedStandardCode": "DEMO_FOUR_POINT_KNIT_V1"
  },
  {
    "testDimensions": {
      "structure": "KNIT",
      "fiber": "NYLON"
    },
    "body": {
      "code": "DEMO-KNIT_NYLON_V1",
      "nameZh": "DEMO TEST 针织锦纶合成样例【非实物】",
      "composition": "100% 锦纶（TEST 虚构）",
      "widthCm": 150,
      "cuttableWidthCm": 145,
      "gsm": 180,
      "weaveStructure": "针织（TEST）",
      "notes": "TEST合成资料；仅验证边界与流程，不代表真实面料",
      "isActive": true
    },
    "expectedTemplateCode": "DEMO_TEMPLATE_KNIT_V1",
    "expectedStandardCode": "DEMO_FOUR_POINT_KNIT_V1"
  },
  {
    "testDimensions": {
      "structure": "WOVEN",
      "fiber": "POLYESTER"
    },
    "body": {
      "code": "DEMO-WOVEN_POLYESTER_V1",
      "nameZh": "DEMO TEST 梭织涤纶合成样例【非实物】",
      "composition": "100% 涤纶（TEST 虚构）",
      "widthCm": 150,
      "cuttableWidthCm": 145,
      "gsm": 180,
      "weaveStructure": "梭织（TEST）",
      "notes": "TEST合成资料；仅验证边界与流程，不代表真实面料",
      "isActive": true
    },
    "expectedTemplateCode": "DEMO_TEMPLATE_WOVEN_V1",
    "expectedStandardCode": "DEMO_FOUR_POINT_WOVEN_V1"
  },
  {
    "testDimensions": {
      "structure": "WOVEN",
      "fiber": "NYLON"
    },
    "body": {
      "code": "DEMO-WOVEN_NYLON_V1",
      "nameZh": "DEMO TEST 梭织锦纶合成样例【非实物】",
      "composition": "100% 锦纶（TEST 虚构）",
      "widthCm": 150,
      "cuttableWidthCm": 145,
      "gsm": 180,
      "weaveStructure": "梭织（TEST）",
      "notes": "TEST合成资料；仅验证边界与流程，不代表真实面料",
      "isActive": true
    },
    "expectedTemplateCode": "DEMO_TEMPLATE_WOVEN_V1",
    "expectedStandardCode": "DEMO_FOUR_POINT_WOVEN_V1"
  }
] as const;

export const DEMO_DEFECTS = [
  {
    "code": "SLUB",
    "nameZh": "粗节",
    "nameEn": "Slub",
    "defaultSeverity": "MINOR",
    "category": "纱线"
  },
  {
    "code": "NEP",
    "nameZh": "棉结",
    "nameEn": "Nep",
    "defaultSeverity": "MINOR",
    "category": "纱线"
  },
  {
    "code": "KNOT",
    "nameZh": "结头",
    "nameEn": "Knot",
    "defaultSeverity": "MINOR",
    "category": "纱线"
  },
  {
    "code": "BROKEN_END",
    "nameZh": "断经",
    "nameEn": "Broken end",
    "defaultSeverity": "MAJOR",
    "category": "织造"
  },
  {
    "code": "BROKEN_PICK",
    "nameZh": "断纬",
    "nameEn": "Broken pick",
    "defaultSeverity": "MAJOR",
    "category": "织造"
  },
  {
    "code": "MISSING_PICK",
    "nameZh": "缺纬",
    "nameEn": "Missing pick",
    "defaultSeverity": "MAJOR",
    "category": "织造"
  },
  {
    "code": "FLOAT",
    "nameZh": "跳纱",
    "nameEn": "Float",
    "defaultSeverity": "MAJOR",
    "category": "织造"
  },
  {
    "code": "BARRE",
    "nameZh": "横档",
    "nameEn": "Barre",
    "defaultSeverity": "MAJOR",
    "category": "织造"
  },
  {
    "code": "HOLE",
    "nameZh": "破洞",
    "nameEn": "Hole",
    "defaultSeverity": "MAJOR",
    "category": "外观"
  },
  {
    "code": "OIL",
    "nameZh": "油污",
    "nameEn": "Oil stain",
    "defaultSeverity": "MAJOR",
    "category": "污渍"
  },
  {
    "code": "STAIN",
    "nameZh": "污渍",
    "nameEn": "Stain",
    "defaultSeverity": "MINOR",
    "category": "污渍"
  },
  {
    "code": "CREASE",
    "nameZh": "折痕",
    "nameEn": "Crease",
    "defaultSeverity": "MINOR",
    "category": "外观"
  },
  {
    "code": "SHADING",
    "nameZh": "色差（连续）",
    "nameEn": "Shading",
    "defaultSeverity": "MAJOR",
    "category": "染整"
  },
  {
    "code": "CONT_STREAK",
    "nameZh": "条花（连续）",
    "nameEn": "Continuous streak",
    "defaultSeverity": "MAJOR",
    "category": "染整"
  },
  {
    "code": "COATING",
    "nameZh": "涂层不良",
    "nameEn": "Coating defect",
    "defaultSeverity": "MAJOR",
    "category": "涂层"
  },
  {
    "code": "MISSED_STITCH",
    "nameZh": "漏针",
    "nameEn": "Missed stitch",
    "defaultSeverity": "MAJOR",
    "category": "织造"
  },
  {
    "code": "LADDERING",
    "nameZh": "脱散",
    "nameEn": "Laddering / Run",
    "defaultSeverity": "MAJOR",
    "category": "织造"
  },
  {
    "code": "NEEDLE_LINE",
    "nameZh": "针路",
    "nameEn": "Needle line",
    "defaultSeverity": "MINOR",
    "category": "织造"
  },
  {
    "code": "SNAG",
    "nameZh": "勾丝",
    "nameEn": "Snag",
    "defaultSeverity": "MINOR",
    "category": "织造"
  }
] as const;

/** Seed-only actor for cross-department isolation fixture; never exposed as a persona. */
export const DEMO_SEED_ACTOR = { id:'b8374589-708e-4c16-893e-c46b7e07a243', employeeNo:'DEMO-SALES-01-SEED', name:'演示一部数据创建员', role:'SALES', departmentId:SALES_1, roleDepartmentId:SALES_1, switchable:false } as const;
export const DEMO_MANIFEST_VERSION = 'v1' as const;
