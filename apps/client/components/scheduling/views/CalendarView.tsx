"use client";

/**
 * @file CalendarView.tsx
 * @description Calendar-based scheduling view for the multi-platform scheduler that displays
 * available slots and optimal times, and handles slot selection for scheduling new posts.
 */

import React, { useMemo, useCallback } from "react";
import type {
  AvailableSlot,
  OptimalTime,
  CalendarDay,
  CreateScheduleInput,
} from "../../../types/multi-platform-scheduling";

interface CalendarViewProps {
  currentWeek: Date;
  slots: AvailableSlot[];
  optimalTimes: OptimalTime[];
  selectedProviders: string[];
  selectedContent?: string | undefined;
  onWeekChange: (direction: "prev" | "next") => void;
  onCreateSchedule: (scheduleData: CreateScheduleInput) => void;
  onSmartSchedule: (providers: string[], numberOfPosts: number) => void;
}

export function CalendarView({
  currentWeek,
  slots,
  optimalTimes,
  selectedProviders,
  selectedContent,
  onWeekChange,
  onCreateSchedule,
  onSmartSchedule,
}: CalendarViewProps) {
  // Generate calendar grid for current week
  const calendarDays = useMemo((): CalendarDay[] => {
    const startOfWeek = new Date(currentWeek);
    startOfWeek.setDate(currentWeek.getDate() - currentWeek.getDay());

    const days: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + i);

      const daySlots = slots.filter((slot) => {
        const slotDate = new Date(slot.datetime);
        return slotDate.toDateString() === day.toDateString();
      });

      const optimalForDay = optimalTimes.filter((time) => time.dayOfWeek === day.getDay());

      days.push({
        date: day,
        slots: daySlots,
        optimalTimes: optimalForDay,
        isToday: day.toDateString() === new Date().toDateString(),
      });
    }

    return days;
  }, [currentWeek, slots, optimalTimes]);

  const getSlotColor = useCallback((available: boolean) => {
    return available
      ? "bg-blue-100 text-blue-800 border-blue-200"
      : "bg-gray-100 text-gray-500 border-gray-200";
  }, []);

  const getDayName = useCallback((date: Date) => {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }, []);

  return (
    <div className="space-y-6">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onWeekChange("prev")}
          className="px-4 py-2 border rounded-lg hover:bg-gray-50 focus:ring-2 focus:ring-blue-500"
          aria-label="Previous week"
        >
          ← Previous Week
        </button>

        <h3 className="text-lg font-medium">
          {currentWeek.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </h3>

        <button
          onClick={() => onWeekChange("next")}
          className="px-4 py-2 border rounded-lg hover:bg-gray-50 focus:ring-2 focus:ring-blue-500"
          aria-label="Next week"
        >
          Next Week →
        </button>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-4">
        {calendarDays.map((day, index) => (
          <div
            key={index}
            className="border rounded-lg p-4 min-h-[200px] focus-within:ring-2 focus-within:ring-blue-500"
          >
            <div
              className={`font-medium mb-3 pb-2 border-b ${
                day.isToday ? "text-blue-600 border-blue-200" : "text-gray-900 border-gray-200"
              }`}
            >
              {getDayName(day.date)}
              <br />
              <span className="text-sm">{day.date.getDate()}</span>
            </div>

            {/* Optimal times indicators */}
            {day.optimalTimes.length > 0 && (
              <div className="mb-2">
                <div className="text-xs text-green-600 mb-1" aria-label="Optimal posting times">
                  ⭐ Optimal:
                </div>
                {day.optimalTimes.slice(0, 2).map((time, i) => (
                  <div key={i} className="text-xs text-green-600">
                    {time.hour}:00 ({Math.round(time.avgEngagement)}% eng.)
                  </div>
                ))}
              </div>
            )}

            {/* Available/scheduled slots */}
            <div className="space-y-2">
              {day.slots.map((slot, slotIndex) => (
                <div
                  key={slotIndex}
                  className={`p-2 rounded-sm text-xs border ${getSlotColor(slot.available)}`}
                  aria-label={`Slot at ${new Date(slot.datetime).toLocaleTimeString()} — ${slot.available ? "available" : "unavailable"}`}
                >
                  <div className="font-medium">
                    {new Date(slot.datetime).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  {slot.reason && <div className="text-xs opacity-75 mt-1">{slot.reason}</div>}
                </div>
              ))}
            </div>

            {/* Add new schedule button */}
            <button
              onClick={() => {
                onCreateSchedule({
                  projectId: "",
                  dayOfWeek: day.date.getDay(),
                  hour: 12,
                  minute: 0,
                  providers: selectedProviders,
                });
              }}
              className="w-full mt-2 p-2 border-2 border-dashed border-gray-300 rounded-sm text-xs text-gray-500 hover:border-blue-300 hover:text-blue-600 focus:ring-2 focus:ring-blue-500"
              aria-label={`Add post on ${day.date.toLocaleDateString()}`}
            >
              + Add Post
            </button>
          </div>
        ))}
      </div>

      {/* Quick scheduling actions */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="font-medium mb-3">Quick Actions</h4>
        <div className="flex space-x-4">
          <button
            onClick={() => onSmartSchedule(selectedProviders, 3)}
            disabled={selectedProviders.length === 0 || !selectedContent}
            className="px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-700 focus:ring-2 focus:ring-green-500"
            aria-disabled={selectedProviders.length === 0 || !selectedContent}
          >
            🎯 Smart Schedule (3 posts)
          </button>
          <button
            onClick={() => onSmartSchedule(selectedProviders, 1)}
            disabled={selectedProviders.length === 0 || !selectedContent}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 focus:ring-2 focus:ring-blue-500"
            aria-disabled={selectedProviders.length === 0 || !selectedContent}
          >
            ⚡ Schedule at Optimal Time
          </button>
        </div>
      </div>
    </div>
  );
}
