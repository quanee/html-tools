import { announce, attempt, copyText, element, onAction } from "../../ui/dom";
import {
  formatDate,
  formatTimestamp,
  localZoneLabel,
  parseDate,
  parseTimestamp,
  type TimestampUnit,
  type TimeZone,
} from "./convert";

export function mountTimestamp(root: HTMLElement): void {
  const zone = element<HTMLSelectElement>(root, "#time-zone");
  element<HTMLOptionElement>(zone, '[value="local"]').textContent = `本地 · ${localZoneLabel()}`;
  const unit = element<HTMLSelectElement>(root, "#timestamp-unit");
  const timestamp = element<HTMLInputElement>(root, "#timestamp-input");
  const date = element<HTMLInputElement>(root, "#date-input");
  const dateOutput = element<HTMLTextAreaElement>(root, "#date-output");
  const fromStatus = element<HTMLElement>(root, "#timestamp-status");
  const toStatus = element<HTMLElement>(root, "#date-status");
  const units = ["seconds", "milliseconds", "nanoseconds"] as const;
  const results = units.map((value) => ({
    unit: value,
    field: element<HTMLInputElement>(root, `#result-${value}`),
    button: element<HTMLButtonElement>(root, `[data-copy="${value}"]`),
  }));
  const dateCopy = element<HTMLButtonElement>(root, '[data-action="copy-date"]');

  function clearFrom() {
    dateOutput.value = "";
    dateCopy.disabled = true;
    announce(fromStatus);
  }
  function clearTo() {
    results.forEach(({ field, button }) => {
      field.value = "";
      button.disabled = true;
    });
    announce(toStatus);
  }
  function convertFrom() {
    clearFrom();
    attempt(fromStatus, () => {
      const value = parseTimestamp(timestamp.value, unit.value as TimestampUnit);
      dateOutput.value = formatDate(value, zone.value as TimeZone);
      dateCopy.disabled = false;
      announce(fromStatus, "转换完成，保留完整纳秒精度。小数点后为 9 位。");
    });
  }
  function convertTo() {
    clearTo();
    attempt(toStatus, () => {
      const value = parseDate(date.value, zone.value as TimeZone);
      const correspondingDate = formatDate(value, zone.value as TimeZone);
      results.forEach(({ field, button, unit }) => {
        field.value = formatTimestamp(value, unit);
        button.disabled = false;
      });
      announce(toStatus, `对应日期：${correspondingDate}`);
    });
  }
  timestamp.addEventListener("input", clearFrom);
  date.addEventListener("input", clearTo);
  unit.addEventListener("change", clearFrom);
  zone.addEventListener("change", () => {
    clearFrom();
    clearTo();
  });
  timestamp.addEventListener("keydown", (event) => {
    if (event.key === "Enter") convertFrom();
  });
  date.addEventListener("keydown", (event) => {
    if (event.key === "Enter") convertTo();
  });
  onAction(root, "to-date", convertFrom);
  onAction(root, "to-timestamp", convertTo);
  onAction(root, "now-timestamp", () => {
    timestamp.value = formatTimestamp(BigInt(Date.now()) * 1_000_000n, unit.value as TimestampUnit);
    clearFrom();
    timestamp.focus();
  });
  onAction(root, "now-date", () => {
    date.value = formatDate(BigInt(Date.now()) * 1_000_000n, zone.value as TimeZone);
    clearTo();
    date.focus();
  });
  onAction(root, "clear-timestamp", () => {
    timestamp.value = "";
    clearFrom();
    timestamp.focus();
  });
  onAction(root, "clear-date", () => {
    date.value = "";
    clearTo();
    date.focus();
  });
  onAction(root, "copy-date", () => {
    void copyText(dateOutput, fromStatus);
  });
  results.forEach(({ field, button }) =>
    button.addEventListener("click", () => {
      void copyText(field, toStatus);
    }),
  );
}
