import merge from 'lodash/merge';

// Each example is a complete sample form. Into an empty form we take it whole; into an existing
// form we only take its fields, so the form's own title, description and required list survive
// (lodash merge would overwrite them, and merges `required` arrays by index), and new fields are
// appended to ui:order, since RJSF refuses to render when ui:order leaves out a property.
export default function insertExampleFields(
  currentSchema: any,
  currentUi: any,
  exampleSchema: any,
  exampleUi: any,
): { schema: any; ui: any } {
  const currentFields = Object.keys(currentSchema.properties ?? {});
  if (currentFields.length === 0) {
    return {
      schema: merge({}, currentSchema, exampleSchema),
      ui: merge({}, currentUi, exampleUi),
    };
  }

  const schema = merge({}, currentSchema, {
    properties: exampleSchema.properties ?? {},
  });
  const required = [
    ...new Set([
      ...(currentSchema.required ?? []),
      ...(exampleSchema.required ?? []),
    ]),
  ];
  if (required.length > 0) {
    schema.required = required;
  }

  const ui = merge({}, currentUi, exampleUi);
  const order = currentUi['ui:order'];
  if (Array.isArray(order) && !order.includes('*')) {
    const newFields = Object.keys(exampleSchema.properties ?? {}).filter(
      (field) => !order.includes(field),
    );
    ui['ui:order'] = [...order, ...newFields];
  }
  return { schema, ui };
}
