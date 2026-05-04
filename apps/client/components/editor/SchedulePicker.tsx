"use client";

/**
 * @file SchedulePicker.tsx
 * @description Date/time scheduling dialog with timezone selection, optimal posting
 * time suggestions per platform, and quick-pick presets (e.g. tomorrow, next week).
 */

import { useState, useEffect } from "react";
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
  reason: string;
}

// Common timezone options
const TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)", offset: "-05:00" },
  { value: "America/Chicago", label: "Central Time (CT)", offset: "-06:00" },
  { value: "America/Denver", label: "Mountain Time (MT)", offset: "-07:00" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)", offset: "-08:00" },
  { value: "Europe/London", label: "Greenwich Mean Time (GMT)", offset: "+00:00" },
  { value: "Europe/Paris", label: "Central European Time (CET)", offset: "+01:00" },
  { value: "Asia/Tokyo", label: "Japan Standard Time (JST)", offset: "+09:00" },
  { value: "Asia/Shanghai", label: "China Standard Time (CST)", offset: "+08:00" },
  { value: "Australia/Sydney", label: "Australian Eastern Time (AET)", offset: "+11:00" },
  { value: "UTC", label: "Coordinated Universal Time (UTC)", offset: "+00:00" },
];

// Heuristic optimal posting times based on platform and day of week
const getOptimalTimes = (providers: string[], date: Date): OptimalTime[] => {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  const optimalTimes: OptimalTime[] = [];

  if (providers.includes("x") || providers.includes("twitter")) {
    if (isWeekday) {
      optimalTimes.push(
        { hour: 9, minute: 0, score: 85, reason: "High engagement during morning commute" },
        { hour: 12, minute: 0, score: 90, reason: "Peak lunch break activity" },
        { hour: 17, minute: 0, score: 88, reason: "Evening commute peak time" }
      );
    } else {
      optimalTimes.push(
        { hour: 10, minute: 0, score: 75, reason: "Weekend morning activity" },
        { hour: 14, minute: 0, score: 80, reason: "Weekend afternoon engagement" }
      );
    }
  }

  if (providers.includes("linkedin")) {
    if (isWeekday) {
      optimalTimes.push(
        { hour: 8, minute: 0, score: 92, reason: "Professional network morning check" },
        { hour: 12, minute: 0, score: 85, reason: "Business lunch break" },
        { hour: 17, minute: 0, score: 88, reason: "End of workday networking" }
      );
    } else {
      optimalTimes.push({
        hour: 10,
        minute: 0,
        score: 60,
        reason: "Lower weekend professional activity",
      });
    }
  }

  if (providers.includes("instagram")) {
    optimalTimes.push(
      { hour: 11, minute: 0, score: 85, reason: "Visual content prime time" },
      { hour: 14, minute: 0, score: 88, reason: "Afternoon scroll peak" },
      { hour: 19, minute: 0, score: 92, reason: "Evening leisure browsing" }
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
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [timezone, setTimezone] = useState<string>("America/New_York");
  const [, setCustomDateTime] = useState<Date | null>(null);
  const [showOptimalTimes, setShowOptimalTimes] = useState(true);

  // Initialize with user's local timezone
  useEffect(() => {
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const matchingTimezone = TIMEZONES.find((tz) => tz.value === userTimezone);
    if (matchingTimezone) {
      setTimezone(userTimezone);
    }
  }, []);

  // Generate next 7 days for quick selection
  const getQuickDateOptions = () => {
    const options = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(new Date(), i);
      options.push({
        value: format(date, "yyyy-MM-dd"),
        label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : format(date, "EEEE, MMM d"),
        date,
      });
    }
    return options;
  };

  const quickDateOptions = getQuickDateOptions();

  // Get optimal times for selected date
  const getOptimalTimesForDate = () => {
    if (!selectedDate) return [];
    const date = parse(selectedDate, "yyyy-MM-dd", new Date());
    return getOptimalTimes(selectedProviders, date);
  };

  const optimalTimes = getOptimalTimesForDate();

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
        title: "Invalid schedule time",
        description: "Scheduled time must be in the future.",
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
        <h4 className="font-medium mb-2">Scheduled for:</h4>
        <p className="text-sm">{format(scheduledDateTime, "EEEE, MMMM d, yyyy 'at' h:mm a")}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {selectedTimezone?.label} ({selectedTimezone?.offset})
        </p>
      </div>
    );
  };

  const scheduleContent = (
    <div className="space-y-6">
      {/* Quick Date Selection */}
      <div className="space-y-3">
        <Label>Select Date</Label>
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
            Or pick a custom date:
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
              Suggested Times
            </CardTitle>
            <CardDescription>
              Typical high-engagement windows for your selected platforms (general heuristic — tune
              via analytics once enough post history is collected).
            </CardDescription>
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
                    <span className="text-sm text-muted-foreground">{time.reason}</span>
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
              Choose custom time instead
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Custom Time Selection */}
      {selectedDate && (!showOptimalTimes || optimalTimes.length === 0) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Select Time</Label>
            {optimalTimes.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowOptimalTimes(true)}>
                <TrendingUp className="h-4 w-4 mr-1" />
                Show optimal times
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
          Timezone
        </Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label} ({tz.offset})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Schedule Preview */}
      {getSchedulePreview()}

      {/* Warning for past times */}
      {selectedDate &&
        selectedTime &&
        (() => {
          const date = parse(selectedDate, "yyyy-MM-dd", new Date());
          const { hours, minutes } = parseTime(selectedTime);
          const scheduledDateTime = setMinutes(setHours(date, hours), minutes);
          return !isAfter(scheduledDateTime, new Date());
        })() && (
          <div
            role="alert"
            className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800"
          >
            <AlertCircle aria-hidden="true" className="h-4 w-4" />
            <span className="text-sm">
              Selected time is in the past. Please choose a future date and time.
            </span>
          </div>
        )}

      {/* Actions */}
      {!inline && (
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSchedule}
            disabled={
              !selectedDate ||
              !selectedTime ||
              (() => {
                if (!selectedDate || !selectedTime) return true;
                const date = parse(selectedDate, "yyyy-MM-dd", new Date());
                const { hours, minutes } = parseTime(selectedTime);
                const scheduledDateTime = setMinutes(setHours(date, hours), minutes);
                return !isAfter(scheduledDateTime, new Date());
              })()
            }
          >
            <Calendar className="h-4 w-4 mr-2" />
            Schedule Post
          </Button>
        </div>
      )}

      {inline && selectedDate && selectedTime && (
        <div className="pt-4 border-t">
          <Button
            onClick={handleSchedule}
            className="w-full"
            disabled={(() => {
              const date = parse(selectedDate, "yyyy-MM-dd", new Date());
              const { hours, minutes } = parseTime(selectedTime);
              const scheduledDateTime = setMinutes(setHours(date, hours), minutes);
              return !isAfter(scheduledDateTime, new Date());
            })()}
          >
            <Calendar className="h-4 w-4 mr-2" />
            Schedule for {format(parse(selectedDate, "yyyy-MM-dd", new Date()), "MMM d")} at{" "}
            {selectedTime}
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
            Schedule Post
          </DialogTitle>
          <DialogDescription>
            Choose when to publish your post for maximum engagement.
          </DialogDescription>
        </DialogHeader>
        {scheduleContent}
      </DialogContent>
    </Dialog>
  );
}
