import { useState, useRef, useEffect } from 'react';
import { format, parse, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isValid } from 'date-fns';
import { vi } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

interface DatePickerInputProps {
  value: string; // DD/MM/YYYY
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  error?: boolean;
}

function parseDDMMYYYY(s: string): Date | null {
  if (!s) return null;
  const d = parse(s, 'dd/MM/yyyy', new Date());
  return isValid(d) ? d : null;
}

function formatDDMMYYYY(d: Date): string {
  return format(d, 'dd/MM/yyyy');
}

export function DatePickerInput({ value, onChange, placeholder = 'DD/MM/YYYY', className = '', error = false }: DatePickerInputProps) {
  const [open, setOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => parseDDMMYYYY(value) || new Date());
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedDate = parseDDMMYYYY(value);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const selectDay = (d: Date) => {
    onChange(formatDDMMYYYY(d));
    setOpen(false);
  };

  const selectToday = () => {
    const today = new Date();
    onChange(formatDDMMYYYY(today));
    setCurrentMonth(today);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          value={value}
          onChange={e => {
            onChange(e.target.value);
            const parsed = parseDDMMYYYY(e.target.value);
            if (parsed) setCurrentMonth(parsed);
          }}
          placeholder={placeholder}
          className={`w-full border rounded-xl px-3 py-2 pr-9 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${error ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'} ${className}`}
        />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition-colors"
        >
          <CalendarDays size={16} />
        </button>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-3 w-[280px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1 rounded hover:bg-slate-100"><ChevronLeft size={16} /></button>
            <span className="text-sm font-medium text-slate-700 capitalize">
              {format(currentMonth, 'MMMM yyyy', { locale: vi })}
            </span>
            <button type="button" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1 rounded hover:bg-slate-100"><ChevronRight size={16} /></button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-1">
            {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(d => (
              <div key={d} className="text-center text-[10px] font-medium text-slate-400 py-1">{d}</div>
            ))}
          </div>

          {/* Days */}
          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const isCurrentMonth = isSameMonth(d, currentMonth);
              const isSelected = selectedDate && isSameDay(d, selectedDate);
              const isToday = isSameDay(d, new Date());
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectDay(d)}
                  className={`w-8 h-8 mx-auto rounded-lg text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-indigo-600 text-white'
                      : isToday
                        ? 'bg-indigo-50 text-indigo-700 font-bold'
                        : isCurrentMonth
                          ? 'text-slate-700 hover:bg-slate-100'
                          : 'text-slate-300'
                  }`}
                >
                  {format(d, 'd')}
                </button>
              );
            })}
          </div>

          {/* Today button */}
          <button
            type="button"
            onClick={selectToday}
            className="w-full mt-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
          >
            Hôm nay
          </button>
        </div>
      )}
    </div>
  );
}
