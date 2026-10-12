"""Reviewed bounded deterministic reference; no artifact/code loading or network API."""
from __future__ import annotations
import importlib.metadata
import re
from typing import Annotated
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StrictStr, model_validator
from pypfopt import EfficientFrontier

Scalar = StrictFloat | StrictInt
SOLVER_OPTIONS = {"tol_gap_abs": 1e-10, "tol_gap_rel": 1e-10, "tol_feas": 1e-10, "max_iter": 200}
FIXTURE = {
    "tickers": ["AGG", "SPY", "GLD", "HYG"],
    "covariance": [[.000859, -.000941, .001494, -.000062],
                   [-.000941, .022400, -.002184, .005747],
                   [.001494, -.002184, .011518, -.000129],
                   [-.000062, .005747, -.000129, .002287]],
}

class Request(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    tickers: Annotated[list[StrictStr], Field(min_length=2, max_length=8)]
    covariance: Annotated[list[Annotated[list[Scalar], Field(min_length=2,max_length=8)]], Field(min_length=2,max_length=8)]

    @model_validator(mode="after")
    def check_matrix(self):
        n = len(self.tickers)
        if len(set(self.tickers)) != n or any(not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,15}", t) for t in self.tickers):
            raise ValueError("tickers must be unique bounded uppercase labels")
        if len(self.covariance) != n or any(len(row) != n for row in self.covariance):
            raise ValueError("covariance dimensions must match ticker ordering")
        c = np.asarray(self.covariance, dtype=float)
        if not np.isfinite(c).all() or np.max(np.abs(c)) > 100:
            raise ValueError("covariance must be finite and bounded by 100")
        if not np.array_equal(c, c.T):
            raise ValueError("covariance must be exactly symmetric; no silent repair")
        scale = float(np.max(np.abs(c)))
        if 0 < scale < 1e-200:
            raise ValueError("nonzero covariance scale must be at least 1e-200")
        if np.any(np.diag(c) < 0):
            raise ValueError("covariance diagonal must be nonnegative")
        normalized = c / scale if scale else c
        if np.any((c != 0) & (normalized == 0)):
            raise ValueError("covariance dynamic range loses nonzero entries during normalization")
        # Conservative verification: never accept a negative eigenvalue as PSD.
        # Some singular PSD matrices may be rejected due to roundoff; no repair.
        if np.linalg.eigvalsh(normalized)[0] < 0:
            raise ValueError("positive semidefiniteness not verified at floating-point precision")
        return self

def minimum_variance(request: dict) -> dict:
    """Long-only fully invested minimum variance; input units are preserved."""
    r = Request.model_validate(request)
    c = np.asarray(r.covariance, dtype=float)
    scale = float(np.max(np.abs(c)))
    normalized = c / scale if scale else c
    ef = EfficientFrontier(None, normalized, weight_bounds=(0, 1), solver="CLARABEL", solver_options=SOLVER_OPTIONS)
    ef.min_volatility()
    w = np.asarray(ef._w.value)
    if ef._opt.status != "optimal" or not np.isfinite(w).all():
        raise ValueError("solver did not return a finite optimal result")
    budget = float(abs(w.sum() - 1))
    bound = float(max(0, -w.min(), w.max()-1))
    if budget > 1e-8 or bound > 1e-8:
        raise ValueError("solver result violates feasibility tolerance")
    gradient = 2 * normalized @ w
    active = w > 1e-5
    lagrange = float(np.min(gradient))
    dual = gradient - lagrange
    stationarity = float(np.max(np.abs(dual[active])))
    dual_violation = float(max(0, -dual.min()))
    complementarity = float(np.max(np.abs(w * dual)))
    objective_gap = float(w @ gradient - np.min(gradient))
    normalized_variance = float(w @ normalized @ w)
    variance = float(w @ c @ w)
    if (stationarity > 1e-7 or dual_violation > 1e-7 or
            complementarity > 1e-8 or abs(objective_gap) > 1e-8 or variance < 0 or normalized_variance < 0):
        raise ValueError("solver result fails normalized KKT/objective certificate")
    return {"tickers": r.tickers, "weights": w.tolist(), "variance": variance,
            "covariance_scale": scale, "normalized_variance": normalized_variance,
            "normalized_simplex_duality_gap": objective_gap,
            "normalized_stationarity_residual": stationarity,
            "normalized_dual_violation": dual_violation,
            "normalized_complementarity_residual": complementarity,
            "budget_residual": budget, "bound_violation": bound,
            "solver": "CLARABEL", "solver_version": importlib.metadata.version("clarabel"),
            "solver_status": ef._opt.status, "solver_options": SOLVER_OPTIONS,
            "iterations": ef._opt.solver_stats.num_iters,
            "data_classification": "fixed_reference_non_market", "promotion_allowed": False}
