import { Form, useNavigation } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { insertLink, linkTriggerAt } from "../links";
import NotePicker from "./NotePicker";

type Props = {
  id: string;
  title: string;
  vaultPath: string;
  multiline?: boolean;
  defaultValue?: string;
  placeholder?: string;
  info?: string;
  error?: string;
  autoFocus?: boolean;
  onChange?: () => void;
};

/** Text field or area where typing `[[` opens a note picker and inserts `[[Note]]`, as in Obsidian. */
export default function LinkingTextField({ vaultPath, multiline, defaultValue, onChange, ...field }: Props) {
  const { push, pop } = useNavigation();
  const [value, setValue] = useState(defaultValue ?? "");
  const ref = useRef<Form.TextField>(null);
  // Bumped after a note is picked: once the form is back, put the cursor in this field again.
  const [refocus, setRefocus] = useState(0);

  useEffect(() => {
    if (refocus > 0) ref.current?.focus();
  }, [refocus]);

  function change(next: string) {
    const start = linkTriggerAt(value, next);
    setValue(next);
    onChange?.();
    if (start === undefined) return;
    push(
      <NotePicker
        vaultPath={vaultPath}
        onPick={(link) => {
          setValue(insertLink(next, start, link));
          pop();
          setRefocus((n) => n + 1);
        }}
      />,
    );
  }

  return multiline ? (
    <Form.TextArea ref={ref} {...field} value={value} onChange={change} />
  ) : (
    <Form.TextField ref={ref} {...field} value={value} onChange={change} />
  );
}
