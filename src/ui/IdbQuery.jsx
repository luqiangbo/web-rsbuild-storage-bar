import React, { useState } from "react";
import { Alert, Button, Checkbox, Input, Segmented, Select, Typography } from "antd";
import { parseIdbQueryKey } from "../api/idbQuery.js";
import { usePreferences } from "./preferences.js";
import WideModal from "./WideModal.jsx";

const queryForm = "storagebar-idb-query";

export default function IdbQuery({ indexes, previous, onApply, onClose }) {
  const { t } = usePreferences();
  const [form, setForm] = useState(() => previous?.form ?? {
    mode: "exact", indexName: indexes[0]?.name, lower: "", upper: "", lowerOpen: false, upperOpen: false,
  });
  const [error, setError] = useState("");
  const exact = form.mode === "exact";
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const apply = () => {
    try {
      const lower = form.lower.trim() ? parseIdbQueryKey(form.lower) : undefined;
      const upper = exact ? lower : form.upper.trim() ? parseIdbQueryKey(form.upper) : undefined;
      if (exact && lower === undefined) throw new Error("请输入要查询的主键");
      if (form.mode === "range" && lower === undefined && upper === undefined) throw new Error("请输入至少一个范围边界");
      if (form.mode === "index" && !indexes.some(({ name }) => name === form.indexName)) throw new Error("请选择索引");
      onApply({ form, query: {
        ...(form.mode === "index" ? { indexName: form.indexName } : {}),
        range: { lower, upper, lowerOpen: !exact && form.lowerOpen, upperOpen: !exact && form.upperOpen },
      } });
    } catch (failure) { setError(failure.message); }
  };
  return <WideModal size="md" title={t("IndexedDB 查询")} maskClosable onCancel={onClose} footer={[
    <Button key="cancel" onClick={onClose}>{t("取消")}</Button>,
    <Button key="run" type="primary" htmlType="submit" form={queryForm}>{t("查询")}</Button>,
  ]}>
    <form id={queryForm} className="dialog-stack" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <Segmented block value={form.mode} onChange={(value) => { setError(""); set("mode", value); }} options={[
        { value: "exact", label: t("精确主键") }, { value: "range", label: t("主键范围") },
        { value: "index", label: t("索引"), disabled: !indexes.length },
      ]} />
      {form.mode === "index" && <div className="form-field">
        <span>{t("索引")}</span>
        <Select aria-label={t("索引")} value={form.indexName}
          options={indexes.map(({ name }) => ({ value: name, label: name || t("（空名称）") }))}
          onChange={(value) => set("indexName", value)} />
      </div>}
      <div className="form-field">
        <div className="field-label-row">
          <label htmlFor="idb-query-lower">{t(exact ? "主键 (JSON)" : "下界")}</label>
          {!exact && <Checkbox checked={form.lowerOpen} disabled={!form.lower.trim()}
            onChange={(event) => set("lowerOpen", event.target.checked)}>{t("排除下界")}</Checkbox>}
        </div>
        <Input id="idb-query-lower" className="data-input" value={form.lower} onChange={(event) => set("lower", event.target.value)}
          spellCheck={false} placeholder='"abc", 42, [1,"abc"]' />
      </div>
      {!exact && <div className="form-field">
        <div className="field-label-row">
          <label htmlFor="idb-query-upper">{t("上界")}</label>
          <Checkbox checked={form.upperOpen} disabled={!form.upper.trim()}
            onChange={(event) => set("upperOpen", event.target.checked)}>{t("排除上界")}</Checkbox>
        </div>
        <Input id="idb-query-upper" className="data-input" value={form.upper} onChange={(event) => set("upper", event.target.value)}
          spellCheck={false} placeholder='"xyz", 100, [2,"xyz"]' />
      </div>}
      <div className="query-hint-card">
        <Typography.Text type="secondary">{t("日期和二进制用以下格式，也可以放进复合键数组。")}</Typography.Text>
        <Typography.Text code className="data-input dialog-wrap">{'{"date":"2026-01-01"}  {"binary":"0A00"}'}</Typography.Text>
      </div>
      {error && <Alert type="error" showIcon title={t(error)} />}
    </form>
  </WideModal>;
}
