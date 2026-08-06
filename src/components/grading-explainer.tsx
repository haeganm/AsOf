/**
 * The one box that keeps the numbers honest for a reader who has never heard
 * of a confidence interval. Shared by the scorecard and the studies so the
 * rules are stated once, identically.
 */
export function GradingExplainer() {
  return (
    <details className="border border-rule-2 bg-wash/50 px-5 py-4">
      <summary className="cursor-pointer text-[13px] font-medium">
        How grading works — and how to read these numbers
      </summary>
      <div className="writing mt-3 space-y-3 text-[13.5px]">
        <p>
          Every signal is stamped with the moment it became <em>publicly knowable</em> and sealed.
          Grading pretends you acted on it the only way a person could have: buying at the close of
          the first trading day that ended after you could have known. Then it measures what the
          stock did over the next 5, 20 and 60 trading days — <strong>minus what the S&amp;P 500
          (SPY) did over the exact same days</strong>. That subtraction matters: in a rising market
          everything looks smart, so the only fair question is whether the signal beat simply
          holding the index.
        </p>
        <p>
          A grade is written once, when its horizon has fully elapsed, and never revised. Signals
          imported from the past are kept out of the live scorecard entirely — history you loaded
          after the fact can never prove an edge, because you already know how it ended.
        </p>
        <p>
          <strong>Why some rows are withheld.</strong> Small samples lie. Five wins out of seven
          feels like a 71% hit rate, but with that little data the honest answer is “somewhere
          between roughly 36% and 92%”. Rows are greyed out until there is enough history for the
          range to mean something, rather than dressed up with a precise-looking number.
        </p>
        <p>
          <strong>The luck warning.</strong> With several sources and three horizons each, some rows
          will look good by pure chance — the same way someone in a large crowd will win a coin-flip
          streak. A promising row on a small sample is a suggestion to keep collecting, not a
          finding.
        </p>
      </div>
    </details>
  );
}
