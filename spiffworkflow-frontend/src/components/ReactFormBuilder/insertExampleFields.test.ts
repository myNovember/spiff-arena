import insertExampleFields from './insertExampleFields';
import textSchema from '../../resources/json_schema_examples/text-schema.json';
import textUiSchema from '../../resources/json_schema_examples/text-uischema.json';
import dateSchema from '../../resources/json_schema_examples/date-schema.json';

const leaveSchema = {
  title: 'Leave request',
  type: 'object',
  required: ['leave_type', 'reason'],
  properties: {
    leave_type: { type: 'string', title: 'Leave type' },
    reason: { type: 'string', title: 'Reason' },
  },
};
const leaveUi = {
  reason: { 'ui:widget': 'textarea' },
  'ui:order': ['leave_type', 'reason'],
};

describe('insertExampleFields', () => {
  it('adds the example field without touching the existing form settings', () => {
    const { schema, ui } = insertExampleFields(
      leaveSchema,
      leaveUi,
      textSchema,
      textUiSchema,
    );
    expect(schema.title).toEqual('Leave request');
    expect(schema.description).toBeUndefined();
    expect(schema.required).toEqual(['leave_type', 'reason', 'firstName']);
    expect(Object.keys(schema.properties)).toEqual([
      'leave_type',
      'reason',
      'firstName',
    ]);
    expect(ui['ui:order']).toEqual(['leave_type', 'reason', 'firstName']);
    expect(ui.firstName).toEqual(textUiSchema.firstName);
    expect(ui.reason).toEqual(leaveUi.reason);
  });

  it('keeps the required list when the example has none', () => {
    const { schema, ui } = insertExampleFields(leaveSchema, {}, dateSchema, {});
    expect(schema.required).toEqual(['leave_type', 'reason']);
    expect(ui['ui:order']).toBeUndefined();
  });

  it('leaves a wildcard ui:order alone', () => {
    const { ui } = insertExampleFields(
      leaveSchema,
      { 'ui:order': ['leave_type', '*'] },
      textSchema,
      {},
    );
    expect(ui['ui:order']).toEqual(['leave_type', '*']);
  });

  it('takes the whole example into an empty form', () => {
    const { schema } = insertExampleFields({}, {}, textSchema, textUiSchema);
    expect(schema.title).toEqual(textSchema.title);
    expect(schema.required).toEqual(['firstName']);
  });

  it('does not mutate its inputs', () => {
    const schemaBefore = JSON.stringify(leaveSchema);
    const uiBefore = JSON.stringify(leaveUi);
    insertExampleFields(leaveSchema, leaveUi, textSchema, textUiSchema);
    expect(JSON.stringify(leaveSchema)).toEqual(schemaBefore);
    expect(JSON.stringify(leaveUi)).toEqual(uiBefore);
  });
});
