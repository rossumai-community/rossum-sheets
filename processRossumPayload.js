// @flow

import createMessage from '../utils/createMessage';
import createReplaceOperation from '../utils/createReplaceOperation';
import findBySchemaId from '../utils/findBySchemaId';
import createHyperFormulaInstance from './createHyperFormulaInstance';
import isMetaField from './isMetaField';
import type { ExtensionUserConfig } from './validateUserConfig';
import type { WebhookPayload, WebhookResponse } from '../flowTypes';

export default function processRossumPayload(
  payload: WebhookPayload<ExtensionUserConfig>,
): WebhookResponse {
  const hfInstance = createHyperFormulaInstance(payload);

  const messages = [];
  const operations = [];
  const automationBlockers = [];

  // For each defined worksheet
  for (const [sheetName, sheetConfig] of Object.entries(payload.settings.sheets)) {
    const formulas = sheetConfig.formulas ?? [];

    // And for each defined formula
    for (let i = 0; i < formulas.length; i++) {
      // We iterate over all occurrences of the target datapoint
      if (isMetaField(formulas[i].target)) {
        throw new Error(`Meta fields are not supported as a target: ${formulas[i].target}`);
      }
      const targetDatapoint = findBySchemaId(payload.annotation.content, formulas[i].target);
      for (let j = 0; j < targetDatapoint.length; j++) {
        const cellAddress = {
          col: Object.values(sheetConfig.columns).length + i, // length of "columns" + position in "formulas"
          row: j,
          sheet: hfInstance.getSheetId(sheetName),
        };
        const cellType = hfInstance.getCellValueDetailedType(cellAddress);
        const cellValue = hfInstance.getCellValue(cellAddress);
        if (formulas[i].validation != null) {
          // Validate if user cares about validations (truthy check)
          if (cellValue) {
            if (formulas[i].validation.automation_blocker === true) {
              automationBlockers.push({
                id: targetDatapoint[j].id,
                content: formulas[i].validation.message,
              });
            } else {
              messages.push(
                createMessage(
                  formulas[i].validation.type ?? 'info',
                  formulas[i].validation.message,
                  targetDatapoint[j].id,
                ),
              );
            }
          }
        } else if (cellType === 'NUMBER_DATE') {
          // Otherwise replace date value (as an ISO string)
          // TODO: support other cell types as well?
          const { year, month, day } = hfInstance.numberToDate(cellValue);
          operations.push(createReplaceOperation(targetDatapoint[j], `${year}-${month}-${day}`));
        } else {
          // Otherwise just replace the value (as a string)
          operations.push(createReplaceOperation(targetDatapoint[j], String(cellValue)));
        }
      }
    }
  }

  if (payload.settings.debug === true) {
    messages.push(
      createMessage(
        'info',
        JSON.stringify({
          allSheetsSerialized: hfInstance.getAllSheetsSerialized(),
          allSheetsValues: hfInstance.getAllSheetsValues(),
        }),
      ),
    );
  }

  hfInstance.destroy();

  return {
    messages,
    operations,
    automation_blockers: automationBlockers,
  };
}