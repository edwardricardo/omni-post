"use client";

/**
 * @file SchedulePicker.tsx
 * @description Date/time scheduling dialog with timezone selection, optimal posting
 * time suggestions per platform, and quick-pick presets (e.g. tomorrow, next week).
 * @component SchedulePicker
 * @layer infrastructure
 */

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Input } from "@packages/ui";
import { Label } from "@packages/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@packages/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  toast,
} from "@packages/ui";
import { Calendar, Clock, Globe, TrendingUp, AlertCircle } from "lucide-react";
import { format, addDays, setHours, setMinutes, parse, isAfter } from "date-fns";
import type esMessages from "@/messages/es.json";

type TimezoneLabelKey = keyof (typeof esMessages)["editor"]["schedule"]["timezones"];
type ReasonKey = keyof (typeof esMessages)["editor"]["schedule"]["reasons"];

interface SchedulePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSchedule: (scheduledAt: Date, timezone?: string) => void;
  selectedProviders?: string[];
  inline?: boolean;
}

interface OptimalTime {
  hour: number;
  minute: number;
  score: number;
  reasonKey: ReasonKey;
}

// Common timezone options. `labelKey` resolves under `editor.schedule.timezones.*`;
// the abbreviation/offset suffix is appended at render time.
const TIMEZONES = [
  { value: "America/New_York", labelKey: "easternTime", offset: "-05:00" },
  { value: "America/Chicago", labelKey: "centralTime", offset: "-06:00" },
  { value: "America/Denver", labelKey: "mountainTime", offset: "-07:00" },
  { value: "America/Los_Angeles", labelKey: "pacificTime", offset: "-08:00" },
  { value: "Europe/London", labelKey: "greenwichMeanTime", offset: "+00:00" },
  { value: "Europe/Paris", labelKey: "centralEuropeanTime", offset: "+01:00" },
  { value: "Asia/Tokyo", labelKey: "japanStandardTime", offset: "+09:00" },
  { value: "Asia/Shanghai", labelKey: "chinaStandardTime", offset: "+08:00" },
  { value: "Australia/Sydney", labelKey: "australianEasternTime", offset: "+11:00" },
  { value: "UTC", labelKey: "coordinatedUniversalTime", offset: "+00:00" },
] as const satisfies ReadonlyArray<{ value: string; labelKey: TimezoneLabelKey; offset: string }>;

// Heuristic optimal posting times based on platform and day of week
const getOptimalTimes = (providers: string[], date: Date): OptimalTime[] => {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  const optimalTimes: OptimalTime[] = [];

  if (providers.includes("x") || providers.includes("twitter")) {
    if (isWeekday) {
      optimalTimes.push(
        { hour: 9, minute: 0, score: 85, reasonKey: "morningCommute" },
        { hour: 12, minute: 0, score: 90, reasonKey: "lunchPeak" },
        { hour: 17, minute: 0, score: 88, reasonKey: "eveningCommute" }
      );
    } else {
      optimalTimes.push(
        { hour: 10, minute: 0, score: 75, reasonKey: "weekendMorning" },
        { hour: 14, minute: 0, score: 80, reasonKey: "weekendAfternoon" }
      );
    }
  }

  if (providers.includes("linkedin")) {
    if (isWeekday) {
      optimalTimes.push(
        { hour: 8, minute: 0, score: 92, reasonKey: "professionalMorning" },
        { hour: 12, minute: 0, score: 85, reasonKey: "businessLunch" },
        { hour: 17, minute: 0, score: 88, reasonKey: "endOfWorkday" }
      );
    } else {
      optimalTimes.push({
        hour: 10,
        minute: 0,
        score: 60,
        reasonKey: "weekendProfessional",
      });
    }
  }

  if (providers.includes("instagram")) {
    optimalTimes.push(
      { hour: 11, minute: 0, score: 85, reasonKey: "visualPrimeTime" },
      { hour: 14, minute: 0, score: 88, reasonKey: "afternoonScroll" },
      { hour: 19, minute: 0, score: 92, reasonKey: "eveningLeisure" }
    );
  }

  // Remove duplicates and sort by score
  const uniqueTimes = optimalTimes.reduce((acc, current) => {
    const existing = acc.find(
      (item) => item.hour === current.hour && item.minute === current.minute
    );
    if (!existing) {
      acc.push(current);
    } else if (current.score > existing.score) {
      const index = acc.indexOf(existing);
      acc[index] = current;
    }
    return acc;
  }, [] as OptimalTime[]);

  return uniqueTimes.sort((a, b) => b.score - a.score).slice(0, 5);
};

/**
 * @component SchedulePicker
 * @description Date/time scheduling dialog with timezone selection, optimal posting time
 * suggestions per platform, and quick-pick presets (tomorrow, next week, etc.).
 * @param props.selectedProviders - Platforms used to compute optimal posting times
 * @param props.inline - Renders inline instead of as a dialog overlay
 */
export function SchedulePicker({
  isOpen,
  onClose,
  onSchedule,
  selectedProviders = [],
  inline = false,
}: SchedulePickerProps) {
  const t = useTranslations("editor");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [timezone, setTimezone] = useState<string>(() => {
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONES.some((tz) => tz.value === userTimezone) ? userTimezone : "America/New_York";
  });
  const [, setCustomDateTime] = useState<Date | null>(null);
  const [showOptimalTimes, setShowOptimalTimes] = useState(true);

  // Generate next 7 days for quick selection
  const quickDateOptions = useMemo(() => {
    const options = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(new Date(), i);
      options.push({
        value: format(date, "yyyy-MM-dd"),
        label:
          i === 0
            ? t("schedule.today")
            : i === 1
              ? t("schedule.tomorrow")
              : format(date, "EEEE, MMM d"),
        date,
      });
    }
    return options;
  }, [t]);

  // Get optimal times for selected date
  const optimalTimes = useMemo(() => {
    if (!selectedDate) return [];
    const date = parse(selectedDate, "yyyy-MM-dd", new Date());
    return getOptimalTimes(selectedProviders, date);
  }, [selectedDate, selectedProviders]);

  const isScheduledTimeInPast = useMemo(() => {
    if (!selectedDate || !selectedTime) return false;
    const parts = selectedTime.split(":");
    const hours = Number(parts[0] ?? 0);
    const minutes = Number(parts[1] ?? 0);
    const date = parse(selectedDate, "yyyy-MM-dd", new Date());
    const scheduledDateTime = setMinutes(setHours(date, hours), minutes);
    return !isAfter(scheduledDateTime, new Date());
  }, [selectedDate, selectedTime]);

  const handleOptimalTimeSelect = (optimalTime: OptimalTime) => {
    const time = format(
      setMinutes(setHours(new Date(), optimalTime.hour), optimalTime.minute),
      "HH:mm"
    );
    setSelectedTime(time);
    setShowOptimalTimes(false);
  };

  const parseTime = (timeStr: string): { hours: number; minutes: number } => {
    const parts = timeStr.split(":");
    return {
      hours: Number(parts[0] ?? 0),
      minutes: Number(parts[1] ?? 0),
    };
  };

  const handleSchedule = () => {
    if (!selectedDate || !selectedTime) {
      return;
    }

    const date = parse(selectedDate, "yyyy-MM-dd", new Date());
    const { hours, minutes } = parseTime(selectedTime);
    const scheduledDateTime = setMinutes(setHours(date, hours), minutes);

    // Validate that the scheduled time is in the future
    if (!isAfter(scheduledDateTime, new Date())) {
      toast({
        title: t("schedule.invalidTimeTitle"),
        description: t("schedule.invalidTimeDescription"),
        variant: "destructive",
      });
      return;
    }

    onSchedule(scheduledDateTime, timezone);
    onClose();

    // Reset form
    setSelectedDate("");
    setSelectedTime("");
    setCustomDateTime(null);
    setShowOptimalTimes(true);
  };

  const getSchedulePreview = () => {
    if (!selectedDate || !selectedTime) return null;

    const date = parse(selectedDate, "yyyy-MM-dd", new Date());
    const { hours, minutes } = parseTime(selectedTime);
    const scheduledDateTime = setMinutes(setHours(date, hours), minutes);

    const selectedTimezone = TIMEZONES.find((tz) => tz.value === timezone);

    return (
      <div className="mt-4 p-3 bg-muted rounded-lg">
        <h4 className="font-medium mb-2">{t("schedule.scheduledForLabel")}</h4>
        <p className="text-sm">{format(scheduledDateTime, "EEEE, MMMM d, yyyy 'at' h:mm a")}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {selectedTimezone ? t(`schedule.timezones.${selectedTimezone.labelKey}`) : ""} (
          {selectedTimezone?.offset})
        </p>
      </div>
    );
  };

  const scheduleContent = (
    <div className="space-y-6">
      {/* Quick Date Selection */}
      <div className="space-y-3">
        <Label>{t("schedule.selectDate")}</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {quickDateOptions.map((option) => (
            <Button
              key={option.value}
              variant={selectedDate === option.value ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedDate(option.value)}
              className="text-left justify-start"
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="custom-date" className="text-sm">
            {t("schedule.customDate")}
          </Label>
          <Input
            id="custom-date"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            min={format(new Date(), "yyyy-MM-dd")}
            className="w-auto"
          />
        </div>
      </div>

      {/* Optimal Times */}
      {selectedDate && optimalTimes.length > 0 && showOptimalTimes && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              {t("schedule.suggestedTimes")}
            </CardTitle>
            <CardDescription>{t("schedule.suggestedTimesDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {optimalTimes.map((time, index) => (
                <button
                  type="button"
                  key={index}
                  className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-muted cursor-pointer transition-colors text-left"
                  onClick={() => handleOptimalTimeSelect(time)}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {format(setMinutes(setHours(new Date(), time.hour), time.minute), "h:mm a")}
                      </span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {t(`schedule.reasons.${time.reasonKey}`)}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowOptimalTimes(false)}
              className="w-full mt-3"
            >
              {t("schedule.chooseCustomTime")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Custom Time Selection */}
      {selectedDate && (!showOptimalTimes || optimalTimes.length === 0) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>{t("schedule.selectTime")}</Label>
            {optimalTimes.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowOptimalTimes(true)}>
                <TrendingUp className="h-4 w-4 mr-1" />
                {t("schedule.showOptimalTimes")}
              </Button>
            )}
          </div>
          <Input
            type="time"
            value={selectedTime}
            onChange={(e) => setSelectedTime(e.target.value)}
            className="w-auto"
          />
        </div>
      )}

      {/* Timezone Selection */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <Globe className="h-4 w-4" />
          {t("schedule.timezone")}
        </Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {t(`schedule.timezones.${tz.labelKey}`)} ({tz.offset})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Schedule Preview */}
      {getSchedulePreview()}

      {/* Warning for past times */}
      {selectedDate && selectedTime && isScheduledTimeInPast && (
        <div
          role="alert"
          className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800"
        >
          <AlertCircle aria-hidden="true" className="h-4 w-4" />
          <span className="text-sm">{t("schedule.pastTimeWarning")}</span>
        </div>
      )}

      {/* Actions */}
      {!inline && (
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            {t("schedule.cancel")}
          </Button>
          <Button
            onClick={handleSchedule}
            disabled={!selectedDate || !selectedTime || isScheduledTimeInPast}
          >
            <Calendar className="h-4 w-4 mr-2" />
            {t("schedule.schedulePost")}
          </Button>
        </div>
      )}

      {inline && selectedDate && selectedTime && (
        <div className="pt-4 border-t">
          <Button onClick={handleSchedule} className="w-full" disabled={isScheduledTimeInPast}>
            <Calendar className="h-4 w-4 mr-2" />
            {t("schedule.scheduleForInline", {
              date: format(parse(selectedDate, "yyyy-MM-dd", new Date()), "MMM d"),
              time: selectedTime,
            })}
          </Button>
        </div>
      )}
    </div>
  );

  if (inline) {
    return scheduleContent;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {t("schedule.schedulePost")}
          </DialogTitle>
          <DialogDescription>{t("schedule.dialogDescription")}</DialogDescription>
        </DialogHeader>
        {scheduleContent}
      </DialogContent>
    </Dialog>
  );
}
