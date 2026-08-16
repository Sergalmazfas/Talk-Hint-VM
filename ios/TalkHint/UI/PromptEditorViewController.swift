import UIKit

/// Create or edit a single user prompt (name + content). Calls back via
/// `onSaved` so the list can refresh.
final class PromptEditorViewController: UIViewController {

    /// The prompt being edited, or nil when creating a new one.
    private let prompt: APIClient.UserPrompt?
    var onSaved: (() -> Void)?

    private let nameField = UITextField()
    private let contentView = UITextView()
    private let contentPlaceholder = UILabel()
    private var saveButton: UIBarButtonItem!

    init(prompt: APIClient.UserPrompt?) {
        self.prompt = prompt
        super.init(nibName: nil, bundle: nil)
        title = prompt == nil ? NSLocalizedString("prompt_editor.title.new", comment: "") : NSLocalizedString("prompt_editor.title.edit", comment: "")
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        buildUI()
        nameField.text = prompt?.name
        contentView.text = prompt?.content
        updatePlaceholder()
        updateSaveEnabled()
    }

    private func buildUI() {
        saveButton = UIBarButtonItem(barButtonSystemItem: .save, target: self, action: #selector(saveTapped))
        saveButton.accessibilityIdentifier = "button-save-prompt"
        navigationItem.rightBarButtonItem = saveButton

        let nameLabel = UILabel()
        nameLabel.text = NSLocalizedString("prompt_editor.name.label", comment: "")
        nameLabel.font = .preferredFont(forTextStyle: .footnote)
        nameLabel.textColor = .secondaryLabel

        nameField.placeholder = NSLocalizedString("prompt_editor.name.placeholder", comment: "")
        nameField.borderStyle = .roundedRect
        nameField.font = .preferredFont(forTextStyle: .body)
        nameField.addTarget(self, action: #selector(textChanged), for: .editingChanged)
        nameField.accessibilityIdentifier = "input-prompt-name"

        let contentLabel = UILabel()
        contentLabel.text = NSLocalizedString("prompt_editor.content.label", comment: "")
        contentLabel.font = .preferredFont(forTextStyle: .footnote)
        contentLabel.textColor = .secondaryLabel

        contentView.font = .preferredFont(forTextStyle: .body)
        contentView.layer.borderColor = UIColor.separator.cgColor
        contentView.layer.borderWidth = 1
        contentView.layer.cornerRadius = 8
        contentView.delegate = self
        contentView.accessibilityIdentifier = "input-prompt-content"

        contentPlaceholder.text = NSLocalizedString("prompt_editor.content.placeholder", comment: "")
        contentPlaceholder.font = .preferredFont(forTextStyle: .body)
        contentPlaceholder.textColor = .placeholderText
        contentPlaceholder.numberOfLines = 0
        contentPlaceholder.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(contentPlaceholder)

        let stack = UIStackView(arrangedSubviews: [nameLabel, nameField, contentLabel, contentView])
        stack.axis = .vertical
        stack.spacing = 8
        stack.setCustomSpacing(20, after: nameField)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: guide.topAnchor, constant: 20),
            stack.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: guide.bottomAnchor, constant: -20),
            contentView.heightAnchor.constraint(greaterThanOrEqualToConstant: 200),

            contentPlaceholder.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 8),
            contentPlaceholder.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 5),
            contentPlaceholder.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -5),
        ])
    }

    @objc private func textChanged() { updateSaveEnabled() }

    private func updateSaveEnabled() {
        let hasName = !(nameField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasContent = !contentView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        saveButton.isEnabled = hasName && hasContent
    }

    private func updatePlaceholder() {
        contentPlaceholder.isHidden = !contentView.text.isEmpty
    }

    @objc private func saveTapped() {
        let name = (nameField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let content = contentView.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !content.isEmpty else { return }
        saveButton.isEnabled = false

        Task {
            do {
                if let prompt = prompt {
                    try await APIClient.shared.updatePrompt(id: prompt.id, name: name, content: content)
                } else {
                    try await APIClient.shared.createPrompt(name: name, content: content)
                }
                await MainActor.run {
                    self.onSaved?()
                    self.navigationController?.popViewController(animated: true)
                }
            } catch {
                await MainActor.run {
                    self.saveButton.isEnabled = true
                    let alert = UIAlertController(title: NSLocalizedString("prompt_editor.save_error.title", comment: ""),
                                                  message: error.localizedDescription,
                                                  preferredStyle: .alert)
                    alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
                    self.present(alert, animated: true)
                }
            }
        }
    }
}

// MARK: - UITextViewDelegate

extension PromptEditorViewController: UITextViewDelegate {
    func textViewDidChange(_ textView: UITextView) {
        updatePlaceholder()
        updateSaveEnabled()
    }
}
