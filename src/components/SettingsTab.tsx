import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { API } from '../lib/api';

interface Props {
  config: AppConfig;
  data: DashboardData | null;
  loading: boolean;
  role: UserRole;
  onRefresh: () => void;
}

const SETTING_LABELS: Record<string, string> = {
  ELECTRIC_PRICE: 'Giá điện (VNĐ/kWh)',
  WATER_PRICE_PER_PERSON: 'Giá nước (VNĐ/người)',
  SURCHARGE_PER_PERSON: 'Phụ phí Internet/Rác (VNĐ/người)',
  EXTRA_FEE_SINGLE: 'Phụ thu quá người - Phòng đơn (VNĐ)',
  EXTRA_FEE_DOUBLE: 'Phụ thu quá người - Phòng đôi (VNĐ)',
};

export function SettingsTab({ config, data, loading, role, onRefresh }: Props) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const isAdmin = role === 'admin';
  const settings = data.settings;
  const hasChanges = Object.keys(edits).length > 0;

  const handleChange = (key: string, value: string) => {
    const original = String(settings[key] ?? '');
    if (value === original) {
      const next = { ...edits };
      delete next[key];
      setEdits(next);
    } else {
      setEdits({ ...edits, [key]: value });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, number | string> = {};
      for (const key in edits) {
        payload[key] = isNaN(Number(edits[key])) ? edits[key] : Number(edits[key]);
      }
      await API.updateSettings(config, payload);
      setEdits({});
      onRefresh();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    }
    setSaving(false);
  };

  const allKeys = Object.keys(SETTING_LABELS);
  // Also show any extra keys from settings not in SETTING_LABELS
  for (const key of Object.keys(settings)) {
    if (!allKeys.includes(key)) allKeys.push(key);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Cài đặt hệ thống</h2>
        {isAdmin && hasChanges && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Lưu thay đổi
          </button>
        )}
      </div>

      {!isAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          ⚠️ Bạn đang xem với quyền Viewer. Chỉ Admin mới có thể chỉnh sửa cài đặt.
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-6 py-3 text-left font-medium">Tên cấu hình</th>
              <th className="px-6 py-3 text-left font-medium">Mô tả</th>
              <th className="px-6 py-3 text-left font-medium">Giá trị</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {allKeys.map((key) => {
              const currentValue = edits[key] !== undefined ? edits[key] : String(settings[key] ?? '');
              const isModified = edits[key] !== undefined;
              return (
                <tr key={key} className={`transition-colors ${isModified ? 'bg-indigo-50/50' : 'hover:bg-slate-50/50'}`}>
                  <td className="px-6 py-4 font-mono text-xs text-slate-700">{key}</td>
                  <td className="px-6 py-4 text-slate-500">{SETTING_LABELS[key] || key}</td>
                  <td className="px-6 py-4">
                    {isAdmin ? (
                      <input
                        value={currentValue}
                        onChange={e => handleChange(key, e.target.value)}
                        className={`border rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${isModified ? 'border-indigo-400 bg-white' : 'border-slate-200'}`}
                      />
                    ) : (
                      <span className="font-medium text-slate-800">{Number(currentValue).toLocaleString('vi-VN')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
