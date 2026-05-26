/**
 * @file RecurrenceSelector.tsx
 * @component RecurrenceSelector
 * @description Human-friendly recurrence picker that generates cron expressions.
 * Supports Daily, Weekly (day picker), Monthly (day-of-month), and Custom (raw cron).
 * @layer infrastructure
 */
"use client";

import { useState, useCallback, useId } from "react";
import { useTranslations } from "next-intl";

type RecurrenceType = "daily" | "weekly" | "monthly" | "custom";

const DAYS = [
  { value: 0, labelKey: "daysShort.sun" },
  { value: 1, labelKey: "daysShort.mon" },
  { value: 2, labelKey: "daysShort.tue" },
  { value: 3, labelKey: "daysShort.wed" },
  { value: 4, labelKey: "daysShort.thu" },
  { value: 5, labelKey: "daysShort.fri" },
  { value: 6, labelKey: "daysShort.sat" },
] as const;

function buildCron(
  type: RecurrenceType,
  hour: number,
  minute: number,
  weekDays: number[],
  monthDay: number,
  custom: string
): string {
  const h = hour.toString().padStart(2, "0");
  const m = minute.toString().padStart(2, "0");

  switch (type) {
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly": {
      const days = weekDays.length > 0 ? weekDays.sort((a, b) => a - b).join(",") : "1";
      return `${m} ${h} * * ${days}`;
    }
    case "monthly":
      return `${m} ${h} ${monthDay} * *`;
    case "custom":
      return custom.trim();
  }
}

interface RecurrenceSelectorProps {
  value: string;
  onChange: (cron: string) => void;
}

export function RecurrenceSelector({ value, onChange }: RecurrenceSelectorProps) {
  const t = useTranslations("scheduling.components");
  const [type, setType] = useState<RecurrenceType>("daily");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [weekDays, setWeekDays] = useState<number[]>([1]); // Monday
  const [monthDay, setMonthDay] = useState(1);
  const [custom, setCustom] = useState(value || "0 9 * * *");

  const monthDayId = useId();

  const emit = useCallback(
    (t: RecurrenceType, h: number, m: number, wd: number[], md: number, c: string) => {
      onChange(buildCron(t, h, m, wd, md, c));
    },
    [onChange]
  );

  function handleTypeChange(t: RecurrenceType) {
    setType(t);
    emit(t, hour, minute, weekDays, monthDay, custom);
  }

  function handleHourChange(h: number) {
    setHour(h);
    emit(type, h, minute, weekDays, monthDay, custom);
  }

  function handleMinuteChange(m: number) {
    setMinute(m);
    emit(type, hour, m, weekDays, monthDay, custom);
  }

  function toggleWeekDay(day: number) {
    const next = weekDays.includes(day) ? weekDays.filter((d) => d !== day) : [...weekDays, day];
    setWeekDays(next);
    emit(type, hour, minute, next, monthDay, custom);
  }

  function handleMonthDayChange(md: number) {
    setMonthDay(md);
    emit(type, hour, minute, weekDays, md, custom);
  }

  function handleCustomChange(c: string) {
    setCustom(c);
    emit(type, hour, minute, weekDays, monthDay, c);
  }

  return (
    <div className="space-y-4">
      {/* Type selector */}
      <div className="flex flex-wrap gap-2">
        {(["daily", "weekly", "monthly", "custom"] as RecurrenceType[]).map((rt) => (
          <button
            key={rt}
            type="button"
            onClick={() => handleTypeChange(rt)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              type === rt
                ? "bg-blue-600 text-white"
                : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {t(`recurrenceType.${rt}`)}
          </button>
        ))}
      </div>

      {/* Time picker (shared by daily/weekly/monthly) */}
      {type !== "custom" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{t("timeLabel")}</span>
          <select
            aria-label={t("hourAria")}
            value={hour}
            onChange={(e) => handleHourChange(Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>
                {i.toString().padStart(2, "0")}
              </option>
            ))}
          </select>
          <span className="text-gray-500">:</span>
          <select
            aria-label={t("minuteAria")}
            value={minute}
            onChange={(e) => handleMinuteChange(Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {[0, 15, 30, 45].map((m) => (
              <option key={m} value={m}>
                {m.toString().padStart(2, "0")}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Weekly: day picker */}
      {type === "weekly" && (
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => toggleWeekDay(d.value)}
              className={`w-10 rounded text-sm font-medium py-1 ${
                weekDays.includes(d.value)
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t(d.labelKey)}
            </button>
          ))}
        </div>
      )}

      {/* Monthly: day of month */}
      {type === "monthly" && (
        <div className="flex items-center gap-2">
          <label htmlFor={monthDayId} className="text-sm text-gray-600">
            {t("dayOfMonthLabel")}
          </label>
          <select
            id={monthDayId}
            value={monthDay}
            onChange={(e) => handleMonthDayChange(Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {Array.from({ length: 28 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Custom: raw cron */}
      {type === "custom" && (
        <div className="space-y-1">
          <input
            type="text"
            aria-label={t("cronExpressionAria")}
            value={custom}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder="0 9 * * 1"
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500">{t("cronFormatHint")}</p>
        </div>
      )}
    </div>
  );
}
