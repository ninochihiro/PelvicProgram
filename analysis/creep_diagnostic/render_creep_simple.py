from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


def channel_columns(columns: list[str]) -> list[str]:
    return sorted(
        (column for column in columns if column.startswith("Palm") and column[4:].isdigit()),
        key=lambda column: int(column[4:]),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render a concise 80 kPa creep curve.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--outdir", type=Path, default=Path("analysis/creep_diagnostic/output"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.outdir.mkdir(parents=True, exist_ok=True)

    frame = pd.read_csv(args.input)
    channels = channel_columns(frame.columns.tolist())
    timestamps = pd.to_datetime(frame["timestamp"])
    elapsed = (timestamps - timestamps.iloc[0]).dt.total_seconds().to_numpy()
    values = frame[channels].to_numpy(dtype=float)

    duration = float(elapsed[-1])
    baseline = values[elapsed <= 5].mean(axis=0)
    final = values[elapsed >= duration - 5].mean(axis=0)
    normalized_pct = (values / baseline[np.newaxis, :] - 1.0) * 100.0
    channel_creep = (final / baseline - 1.0) * 100.0

    median_curve = np.median(normalized_pct, axis=1)
    p10_curve = np.percentile(normalized_pct, 10, axis=1)
    p90_curve = np.percentile(normalized_pct, 90, axis=1)
    window = 11
    median_smooth = (
        pd.Series(median_curve).rolling(window, center=True, min_periods=1).median().to_numpy()
    )
    p10_smooth = (
        pd.Series(p10_curve).rolling(window, center=True, min_periods=1).median().to_numpy()
    )
    p90_smooth = (
        pd.Series(p90_curve).rolling(window, center=True, min_periods=1).median().to_numpy()
    )

    median_end = float(np.median(channel_creep))
    upward_count = int((channel_creep > 0).sum())
    above_half = int((channel_creep >= 0.5).sum())
    pressure_mean = float(frame["actual_kpa"].mean())
    pressure_std = float(frame["actual_kpa"].std(ddof=1))
    top = (
        pd.DataFrame({"channel": channels, "creep": channel_creep})
        .sort_values("creep", ascending=False)
        .head(3)
    )

    plt.rcParams.update(
        {
            "font.family": "Microsoft YaHei",
            "font.size": 10,
            "axes.unicode_minus": False,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
        }
    )

    fig, ax = plt.subplots(figsize=(12, 6.7))
    fig.subplots_adjust(left=0.095, right=0.965, bottom=0.20, top=0.78)

    ink = "#1F2937"
    muted = "#6B7280"
    line = "#1D4ED8"
    band = "#DCE5F5"

    ax.fill_between(
        elapsed,
        p10_smooth,
        p90_smooth,
        color=band,
        linewidth=0,
        label="通道 P10–P90",
    )
    ax.plot(elapsed, median_curve, color=line, alpha=0.18, linewidth=1.0)
    ax.plot(elapsed, median_smooth, color=line, linewidth=2.6, label="阵列中位数")
    ax.axhline(0, color="#CBD5E1", linewidth=0.9, zorder=0)

    for second in [10, 30, int(duration)]:
        index = int(np.argmin(np.abs(elapsed - second)))
        y_value = float(median_smooth[index])
        ax.scatter(
            elapsed[index],
            y_value,
            s=28,
            color=line,
            edgecolor="white",
            linewidth=0.8,
            zorder=4,
        )
        ax.annotate(
            f"{elapsed[index]:.0f} s  +{y_value:.2f}%",
            (elapsed[index], y_value),
            xytext=(7, 9),
            textcoords="offset points",
            color=ink,
            fontsize=8.5,
        )

    ax.text(
        0.99,
        0.04,
        "通道 P10–P90",
        transform=ax.transAxes,
        color=muted,
        fontsize=8.5,
        ha="right",
    )
    ax.text(
        0.99,
        0.10,
        "中位数",
        transform=ax.transAxes,
        color=line,
        fontsize=8.5,
        ha="right",
        fontweight="bold",
    )

    ax.set_xlim(0, duration)
    ax.set_ylim(0, max(1.35, float(p90_smooth.max()) * 1.15))
    ax.set_xticks(np.arange(0, duration + 1, 10))
    ax.set_xlabel("加载时间 (s)", color=muted)
    ax.set_ylabel("相对首 5 s 的读数变化 (%)", color=muted)
    ax.grid(axis="y", color="#E5E7EB", linewidth=0.8)
    ax.spines[["top", "right", "left", "bottom"]].set_visible(False)
    ax.tick_params(colors=muted, length=0)
    ax.set_axisbelow(True)

    fig.text(
        0.095,
        0.925,
        "80 kPa 恒压下触觉阵列持续向上漂移",
        fontsize=21,
        fontweight="bold",
        color=ink,
        va="top",
    )
    fig.text(
        0.095,
        0.865,
        f"{len(frame)} 帧 · {duration:.1f} s · 实际压力 {pressure_mean:.2f} ± {pressure_std:.2f} kPa",
        fontsize=9.5,
        color=muted,
        va="top",
    )
    fig.text(
        0.965,
        0.925,
        f"60 s 中位蠕变  +{median_end:.2f}%",
        fontsize=14,
        fontweight="bold",
        color=line,
        ha="right",
        va="top",
    )
    fig.text(
        0.965,
        0.865,
        f"{upward_count}/210 通道上升 · {above_half}/210 超过 0.5%",
        fontsize=9.5,
        color=muted,
        ha="right",
        va="top",
    )

    top_text = "  ·  ".join(
        f"{row.channel} +{row.creep:.2f}%"
        for row in top.itertuples(index=False)
    )
    fig.text(
        0.095,
        0.105,
        f"蠕变最高的通道：{top_text}",
        fontsize=9,
        color=ink,
    )
    fig.text(
        0.095,
        0.060,
        "定义：首 5 s 与末 5 s 的通道均值比较；实际压力存在 79–81 kPa 的小幅波动。",
        fontsize=8.5,
        color=muted,
    )

    png_path = args.outdir / "80kpa_creep_simple.png"
    svg_path = args.outdir / "80kpa_creep_simple.svg"
    fig.savefig(png_path, dpi=240, bbox_inches="tight", facecolor="white")
    fig.savefig(svg_path, bbox_inches="tight", facecolor="white")
    plt.close(fig)

    print(f"PNG: {png_path.resolve()}")
    print(f"SVG: {svg_path.resolve()}")
    print(f"Median creep: +{median_end:.3f}%")


if __name__ == "__main__":
    main()
