from app.modules.masks import CV_EVALUATION_PROMT_TEMPLATE, CV_EVALUATION_SCORING_POLICY


def test_scoring_policy_contains_agreed_penalties():
    assert "required primary programming language absent from the CV: -20" in CV_EVALUATION_SCORING_POLICY
    assert "required cloud or platform technology absent from the CV: -10" in CV_EVALUATION_SCORING_POLICY
    assert "any other explicitly required skill not evidenced in the CV: -5" in CV_EVALUATION_SCORING_POLICY
    assert "experience_penalty = -min(18, 3 * experience_gap_years)" in CV_EVALUATION_SCORING_POLICY
    assert "evidence penalty of -5" in CV_EVALUATION_SCORING_POLICY
    assert "Senior, Lead, or Principal seniority but gives no minimum years" in CV_EVALUATION_SCORING_POLICY


def test_scoring_policy_prevents_double_counting_and_score_caps():
    assert "apply exactly one strongest matching penalty" in CV_EVALUATION_SCORING_POLICY
    assert "Do not add a separate seniority-title penalty" in CV_EVALUATION_SCORING_POLICY
    assert "does not impose a cap on match_score" in CV_EVALUATION_SCORING_POLICY


def test_scoring_policy_synchronizes_score_and_recommendation():
    assert 'recommendation="apply" only when final_score is at least 80' in CV_EVALUATION_SCORING_POLICY
    assert 'recommendation="manual_review" when final_score is from 50 through 79' in CV_EVALUATION_SCORING_POLICY
    assert 'recommendation="reject" when final_score is below 50' in CV_EVALUATION_SCORING_POLICY
    assert "match_score must equal score_breakdown.final_score" in CV_EVALUATION_SCORING_POLICY
    assert CV_EVALUATION_SCORING_POLICY in CV_EVALUATION_PROMT_TEMPLATE
