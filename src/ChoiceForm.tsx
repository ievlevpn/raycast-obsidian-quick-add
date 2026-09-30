import { Action, ActionPanel, Form, Icon } from "@raycast/api";
import { useState } from "react";
import { runChoice } from "./run";
import { Choice } from "./types";

export default function ChoiceForm({ vaultName, choice }: { vaultName: string; choice: Choice }) {
  const [errors, setErrors] = useState<Record<number, string | undefined>>({});
  const loneValue = choice.fields.length === 1 && choice.fields[0].key === "value" && !choice.fields[0].options;

  async function submit(formValues: Record<string, string>) {
    const values = choice.fields.map((_, index) => formValues[`f${index}`] ?? "");
    const missing: Record<number, string> = {};
    choice.fields.forEach((field, index) => {
      if (!field.optional && values[index].trim() === "") missing[index] = "Required";
    });
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }
    await runChoice(vaultName, choice, values);
  }

  const clearError = (index: number) => {
    if (errors[index]) setErrors({ ...errors, [index]: undefined });
  };

  return (
    <Form
      navigationTitle={choice.title}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={choice.type === "Capture" ? "Capture" : "Create"}
            icon={Icon.Checkmark}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      {choice.notes.map((note, index) => (
        <Form.Description key={`note-${index}`} text={note} />
      ))}
      {choice.fields.map((field, index) => {
        const id = `f${index}`;
        if (field.options) {
          const defaultValue =
            field.defaultValue && field.options.includes(field.defaultValue) ? field.defaultValue : field.options[0];
          return (
            <Form.Dropdown
              key={id}
              id={id}
              title={field.label}
              defaultValue={defaultValue}
              error={errors[index]}
              onChange={() => clearError(index)}
            >
              {field.options.map((option) => (
                <Form.Dropdown.Item key={option} value={option} title={option} />
              ))}
            </Form.Dropdown>
          );
        }
        if (loneValue) {
          return (
            <Form.TextArea
              key={id}
              id={id}
              title={choice.name}
              autoFocus
              defaultValue={field.defaultValue}
              error={errors[index]}
              onChange={() => clearError(index)}
            />
          );
        }
        return (
          <Form.TextField
            key={id}
            id={id}
            title={field.label}
            autoFocus={index === 0}
            defaultValue={field.defaultValue}
            placeholder={field.optional ? "Optional" : undefined}
            error={errors[index]}
            onChange={() => clearError(index)}
          />
        );
      })}
    </Form>
  );
}
