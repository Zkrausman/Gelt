"""Independent exhaustive active-set/KKT oracle. No optimizer or PyPortfolioOpt."""
import itertools
import numpy as np

def active_set_oracle(covariance):
    original = np.asarray(covariance, dtype=float)
    magnitude = float(np.max(np.abs(original)))
    c = original / magnitude if magnitude else original
    n = len(c)
    candidates = []
    for size in range(1,n+1):
        for support in itertools.combinations(range(n),size):
            # Equality-constrained minimizer on each simplex face.
            sub = c[np.ix_(support,support)]
            kkt = np.block([[2*sub, -np.ones((size,1))], [np.ones((1,size)),np.zeros((1,1))]])
            rhs = np.r_[np.zeros(size),1.]
            sol, _, _, _ = np.linalg.lstsq(kkt,rhs,rcond=None)
            if np.max(np.abs(kkt@sol-rhs)) > 1e-10 or min(sol[:-1]) < -1e-10:
                continue
            w = np.zeros(n); w[list(support)] = sol[:-1]
            grad = 2*c@w
            inactive = [i for i in range(n) if i not in support]
            if inactive and min(grad[inactive]-sol[-1]) < -1e-10:
                continue
            candidates.append((float(w@c@w),w))
    if not candidates:
        raise ValueError("no feasible KKT active set found")
    variance,w = min(candidates,key=lambda x:x[0])
    gradient = 2*c@w
    lagrange = float(np.mean(gradient[w>1e-8]))
    dual = gradient-lagrange
    return {"weights":w.tolist(),"variance":float(w @ original @ w),
            "stationarity_residual":float(np.max(np.abs(dual[w>1e-8]))),
            "dual_violation":float(max(0,-dual.min())),
            "complementarity_residual":float(np.max(np.abs(w*dual)))}
