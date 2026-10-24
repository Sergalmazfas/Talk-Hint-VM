import UIKit

/// A light proposal surface needs explicit foreground colors even when the
/// surrounding sheet follows the iPhone's dark appearance.
final class PrepareGoalProposalView: UIView {
    let goalLabel = UILabel()
    let confirmationQuestion = UILabel()
    let confirmButton = UIButton(type: .system)
    let editButton = UIButton(type: .system)
    let buttons = UIStackView()

    init(goal: String, secretary: Bool) {
        super.init(frame: .zero)
        backgroundColor = Theme.purpleBg
        layer.cornerRadius = 16
        layer.borderWidth = 1
        layer.borderColor = Theme.purple.withAlphaComponent(0.35).cgColor
        accessibilityIdentifier = "card-goal-proposal"

        let header = UILabel()
        header.text = NSLocalizedString(secretary ? "secretary.prepare.goal_header" : "prepare.goal_header", comment: "")
        header.font = .preferredFont(forTextStyle: .caption1)
        header.textColor = Theme.purple

        goalLabel.text = goal
        goalLabel.numberOfLines = 0
        goalLabel.font = .preferredFont(forTextStyle: .body)
        goalLabel.textColor = Theme.ink
        goalLabel.accessibilityIdentifier = "label-goal-proposal"

        confirmationQuestion.text = NSLocalizedString("secretary.prepare.confirm_question", comment: "")
        confirmationQuestion.numberOfLines = 0
        confirmationQuestion.font = .preferredFont(forTextStyle: .subheadline)
        confirmationQuestion.textColor = Theme.ink
        confirmationQuestion.accessibilityIdentifier = "label-secretary-confirm-question"

        confirmButton.setTitle(NSLocalizedString(secretary ? "secretary.prepare.goal_confirm" : "prepare.goal_confirm", comment: ""), for: .normal)
        confirmButton.setTitleColor(.white, for: .normal)
        confirmButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        confirmButton.backgroundColor = Theme.purple
        confirmButton.layer.cornerRadius = 20
        confirmButton.accessibilityIdentifier = "button-goal-confirm"

        editButton.setTitle(NSLocalizedString(secretary ? "secretary.prepare.goal_edit" : "prepare.goal_edit", comment: ""), for: .normal)
        editButton.setTitleColor(Theme.ink, for: .normal)
        editButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        editButton.backgroundColor = Theme.fill
        editButton.layer.cornerRadius = 20
        editButton.layer.borderWidth = 1
        editButton.layer.borderColor = Theme.line.cgColor
        editButton.accessibilityIdentifier = "button-goal-edit"

        buttons.addArrangedSubview(confirmButton)
        buttons.addArrangedSubview(editButton)
        buttons.axis = .horizontal
        buttons.distribution = .fillEqually
        buttons.spacing = 8
        buttons.heightAnchor.constraint(equalToConstant: 40).isActive = true
        var views: [UIView] = [header, goalLabel]
        if secretary { views.append(confirmationQuestion) }
        views.append(buttons)
        let stack = UIStackView(arrangedSubviews: views)
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
