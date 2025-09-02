/* eslint-disable no-alert */
/* eslint-disable no-console */

/*
  Survey block for AEM Edge Delivery Services.
  Radios, sliders, and read-only "fact" slides.
  Builds DOM nodes (no innerHTML), tracks progress, supports grouped questions.
*/

// Constants used across the survey
const SURVEY_CONSTANTS = {
  MANDATORY_TRUE: 'TRUE',
  QUESTION_TYPE: 'question',
  FACT_TYPE: 'fact',
  SLIDER_TYPE: 'slider',
  RADIO_TYPE: 'radio',
  JSON_EXTENSION: 'json',
};

// Required only if mandatory and it's an actual question (facts don't count)
function isAnswerRequired(question) {
  return (
    question.Mandatory === SURVEY_CONSTANTS.MANDATORY_TRUE
    && question.ContentType === SURVEY_CONSTANTS.QUESTION_TYPE
  );
}

// Null/undefined means unanswered; empty string may be valid for some types
function hasValidAnswer(question, answers) {
  return answers[question.ContentId] != null;
}

// Find all related questions starting from a given index (q5a, q5b, q5c, etc.)
function findRelatedQuestions(surveyData, startIndex) {
  const relatedQuestions = [surveyData[startIndex]];
  const baseId = surveyData[startIndex].ContentId.replace(/[a-z]$/, '');

  // Only consider it a group if the base ID is different from the original (has letter suffix)
  if (baseId === surveyData[startIndex].ContentId) {
    return relatedQuestions; // Single question, no related ones
  }

  // Look for subsequent questions with the same base ID
  for (let i = startIndex + 1; i < surveyData.length; i += 1) {
    const currentQuestion = surveyData[i];
    const currentBaseId = currentQuestion.ContentId.replace(/[a-z]$/, '');

    if (
      currentBaseId === baseId
      && currentBaseId !== currentQuestion.ContentId
    ) {
      relatedQuestions.push(currentQuestion);
    } else {
      break; // Stop when we find a question that doesn't belong to this group
    }
  }

  return relatedQuestions;
}

// Small helper to create elements (no innerHTML)
function createElement(tag, className = '', textContent = '', attributes = {}) {
  const element = document.createElement(tag);
  if (className) element.classList.add(...className.split(' '));
  if (textContent) element.textContent = textContent;

  Object.entries(attributes).forEach(([key, value]) => {
    if (key.startsWith('data-')) {
      element.dataset[key.replace('data-', '')] = value;
    } else {
      element.setAttribute(key, value);
    }
  });

  return element;
}

// Div helper
function createDiv(className = '', textContent = '') {
  return createElement('div', className, textContent);
}

// Button helper
function createButton(className, textContent, type = 'button') {
  return createElement('button', className, textContent, { type });
}

// Add class if needed
function addClassIf(element, className, condition = true) {
  if (element && condition) {
    element.classList.add(className);
  }
}

// Move node to target parent and add class
function moveNode(node, targetParent, className) {
  if (node) {
    addClassIf(node, className);
    if (targetParent && node.parentElement !== targetParent) {
      targetParent.appendChild(node);
    }
  }
}

// Append many children
function appendChildren(parent, children) {
  children.forEach((child) => {
    if (child) parent.appendChild(child);
  });
  return parent;
}

// Attach the same listener to multiple elements
function attachListeners(elements, eventType, handler) {
  elements.forEach((element) => {
    if (element) element.addEventListener(eventType, handler);
  });
}

// Replace container content safely
function replaceContent(container, newContent) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (typeof newContent === 'string') {
    container.textContent = newContent;
  } else if (newContent) {
    container.appendChild(newContent);
  }
}

// Build radio options for a question
function createRadioOptions(contentId, options) {
  const optionElements = options.map((option) => {
    const input = createElement('input', '', '', {
      type: 'radio',
      id: `${contentId}-${option.replace(/\s+/g, '-').toLowerCase()}`,
      name: contentId,
      value: option,
    });

    const label = createElement('label', '', option, {
      for: input.id,
    });

    return appendChildren(createDiv('option'), [input, label]);
  });

  return appendChildren(createDiv('options'), optionElements);
}

// Slider + labels; keep labels in data-options
function createSlider(contentId, options, questionText = '') {
  const elements = [];

  if (questionText) {
    elements.push(createElement('h3', 'slider-question', questionText));
  }

  const labelSpans = options.map((option) => createElement('span', '', option));
  const labelsDiv = appendChildren(createDiv('slider-labels'), labelSpans);

  const slider = createElement('input', 'slider', '', {
    type: 'range',
    id: contentId,
    name: contentId,
    min: '0',
    max: String(options.length - 1),
    value: '0',
    'data-options': JSON.stringify(options),
  });

  const trackWrapper = appendChildren(createDiv('slider-track-wrapper'), [
    labelsDiv,
    slider,
  ]);

  elements.push(trackWrapper);
  return appendChildren(createDiv('slider-container'), elements);
}

// Fetch survey JSON; supports pretty hrefs via /paths.json
async function fetchSurveyData(surveyHref) {
  let mapping = surveyHref;
  if (!surveyHref.endsWith('json')) {
    const mappingresp = await fetch('/paths.json');
    const mappingData = await mappingresp.json();
    const mappingEntries = Object.entries(mappingData.mappings);
    const foundMapping = mappingEntries.find(([, value]) => {
      const [before] = value.split(':');
      return before === surveyHref;
    });
    if (foundMapping) {
      const [, after] = foundMapping[1].split(':');
      mapping = after;
    }
  }
  const resp = await fetch(mapping);
  const json = await resp.json();
  return json;
}

// Normalize API payload (Options can arrive as CSV strings)
function parseSurveyData(surveyResponse) {
  const questions = surveyResponse.data || [];

  const normalizedQuestions = questions.map((item) => {
    if (item.Options && typeof item.Options === 'string') {
      item.Options = item.Options.split(',').map((opt) => opt.trim());
    }
    return item;
  });

  return normalizedQuestions.sort(
    (a, b) => parseInt(a.Order, 10) - parseInt(b.Order, 10),
  );
}

// Progress: count only questions that actually count
function calculateProgress(currentIndex, surveyData) {
  const actualQuestions = surveyData.filter(
    (q) => q.CountsAsQuestion === 'TRUE',
  );
  const totalActualQuestions = actualQuestions.length;

  const questionsCompleted = surveyData
    .slice(0, currentIndex + 1)
    .filter((q) => q.CountsAsQuestion === 'TRUE').length;

  const progress = (questionsCompleted / totalActualQuestions) * 100;
  return { progress, questionsCompleted, totalActualQuestions };
}

// Wrap a slide with progress + content + back/next
function createSurveyTemplate(
  progress,
  questionsCompleted,
  totalActualQuestions,
  section,
  icon,
  contentElement,
) {
  const progressFill = createDiv('progress-fill');
  progressFill.style.width = `${progress}%`;
  const progressTrack = appendChildren(createDiv('progress-track'), [
    progressFill,
  ]);
  const progressCounter = createDiv(
    'progress-counter',
    `${questionsCompleted}/${totalActualQuestions}`,
  );
  const progressDiv = appendChildren(createDiv('progress'), [
    progressTrack,
    progressCounter,
  ]);

  const sectionTitle = createElement('span', 'section-title', section);
  const questionIcon = createDiv('question-icon', icon);
  const navDiv = appendChildren(createDiv('nav'), [
    createButton('btn-back', 'Back'),
    createButton('btn-next', 'Next'),
  ]);
  const contentDiv = appendChildren(createDiv('content'), [
    sectionTitle,
    questionIcon,
    contentElement,
    navDiv,
  ]);

  return appendChildren(createDiv('survey-form'), [progressDiv, contentDiv]);
}

// Pull common props + progress numbers
function getQuestionContext(questionData, currentIndex, surveyData) {
  const { Section, Icon } = questionData;
  const { progress, questionsCompleted, totalActualQuestions } = calculateProgress(
    currentIndex,
    surveyData,
  );
  return {
    Section,
    Icon,
    progress,
    questionsCompleted,
    totalActualQuestions,
  };
}

// Fact slide (read-only)
function createFactContent(questionData, currentIndex, surveyData) {
  const { Title, Question } = questionData;
  const {
    Section, Icon, progress, questionsCompleted, totalActualQuestions,
  } = getQuestionContext(questionData, currentIndex, surveyData);

  const contentElement = appendChildren(createDiv(), [
    createElement('h1', 'title', Title),
    createElement('p', 'fact-content', Question),
  ]);

  return createSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentElement,
  );
}

// Interactive slide (radio/slider, supports grouped sliders)
function createQuestion(questionData, currentIndex, surveyData) {
  const {
    ContentType, Title, Question, Options, OptionType, ContentId,
  } = questionData;

  if (ContentType === SURVEY_CONSTANTS.FACT_TYPE) {
    return createFactContent(questionData, currentIndex, surveyData);
  }

  const {
    Section, Icon, progress, questionsCompleted, totalActualQuestions,
  } = getQuestionContext(questionData, currentIndex, surveyData);

  // Find all related questions (q5a, q5b, q5c, etc.)
  const relatedQuestions = findRelatedQuestions(surveyData, currentIndex);
  const hasMultipleQuestions = relatedQuestions.length > 1;

  const contentElement = createDiv();

  // Add title if present
  if (Title) {
    const titleH1 = createElement('h1', 'title', Title);
    contentElement.appendChild(titleH1);
  }

  // Add main question text (unless it's multiple slider questions where each has its own text)
  if (!(hasMultipleQuestions && OptionType === SURVEY_CONSTANTS.SLIDER_TYPE)) {
    const questionH2 = createElement('h2', 'question', Question);
    contentElement.appendChild(questionH2);
  }

  // Create options container
  const optionsDiv = createDiv('options');

  if (OptionType === SURVEY_CONSTANTS.RADIO_TYPE) {
    // For radio buttons, only use the first question (no grouping for radio)
    const radioOptions = createRadioOptions(ContentId, Options);
    optionsDiv.appendChild(radioOptions);
  } else if (OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
    if (hasMultipleQuestions) {
      // Create multiple related sliders dynamically
      relatedQuestions.forEach((relatedQuestion) => {
        const slider = createSlider(
          relatedQuestion.ContentId,
          relatedQuestion.Options,
          relatedQuestion.Question,
        );
        optionsDiv.appendChild(slider);
      });
    } else {
      // Single slider
      const slider = createSlider(ContentId, Options);
      optionsDiv.appendChild(slider);
    }
  }

  contentElement.appendChild(optionsDiv);

  return createSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentElement,
  );
}

// Answers summary (UL/LI)
function createAnswersListUL(surveyData, surveyAnswers) {
  // Filter only counted questions (e.g., 6/6)
  const countedQuestions = surveyData.filter(
    (q) => q.CountsAsQuestion === 'TRUE'
      && q.ContentType === SURVEY_CONSTANTS.QUESTION_TYPE,
  );
  const total = countedQuestions.length;

  const ul = document.createElement('ul');
  ul.classList.add('answers-list__list');

  countedQuestions.forEach((q, index) => {
    const answerValue = surveyAnswers[q.ContentId];

    const li = document.createElement('li');
    li.classList.add('answers-list__list--item');

    const sectionSpan = createElement('span', '', q.Section || '');

    const contentWrap = createDiv('answers-list__content answer-item');
    const desc = createDiv('answer-item--description');
    const ordinal = createElement('span', '', `Answer ${index + 1}/${total}`);

    // Generic, safe summary: "You selected: <value>."
    const sentenceDiv = document.createElement('div');
    const sPrefix = document.createTextNode('You selected: ');
    const strong = createElement('strong', '', String(answerValue || '—'));
    const sSuffix = document.createTextNode('.');
    appendChildren(sentenceDiv, [sPrefix, strong, sSuffix]);

    appendChildren(desc, [ordinal, sentenceDiv]);

    const iconDiv = createDiv(
      `slide-${index + 1} answer-item--icon`,
      q.Icon || '💡',
    );

    appendChildren(contentWrap, [desc, iconDiv]);
    appendChildren(li, [sectionSpan, contentWrap]);
    ul.appendChild(li);
  });

  return ul;
}

export default function decorate(block) {
  if (!block) return;

  // Don't decorate twice
  if (block.dataset.decorated === '1') return;
  block.dataset.decorated = '1';

  let surveyArea = block.querySelector(':scope > div:nth-child(1)');
  const logo = block.querySelector(':scope > div:nth-child(2)');
  const content = block.querySelector(':scope > div:nth-child(3)');
  const footer = block.querySelector(':scope > div:last-child');

  // Make a survey-area wrapper if missing
  if (!surveyArea && (logo || content)) {
    surveyArea = createDiv();
    block.prepend(surveyArea);
  }

  addClassIf(surveyArea, 'survey-area');

  // Background picture → CSS background
  const bgWrapper = surveyArea?.querySelector(':scope > div:first-child');
  const pic = bgWrapper?.querySelector('picture');
  const img = pic?.querySelector('img');

  if (pic && img && surveyArea) {
    const applyBackgroundAndRemove = () => {
      if (img.currentSrc) {
        surveyArea.style.backgroundImage = `url(${img.currentSrc})`;
        addClassIf(surveyArea, 'has-background');
      }
      if (bgWrapper && bgWrapper.parentElement) {
        bgWrapper.parentElement.removeChild(bgWrapper);
      } else if (pic.parentElement) {
        pic.parentElement.removeChild(pic);
      }
    };

    if (img.currentSrc) {
      img
        .decode()
        .then(applyBackgroundAndRemove)
        .catch(applyBackgroundAndRemove);
    } else {
      img.addEventListener(
        'load',
        () => {
          img
            .decode()
            .then(applyBackgroundAndRemove)
            .catch(applyBackgroundAndRemove);
        },
        { once: true },
      );
    }
  }

  moveNode(logo, surveyArea, 'logo');
  moveNode(content, surveyArea, 'content');

  // Swap <p> button container to <div> (layout)
  const buttonContainer = block.querySelector('p.button-container');
  if (buttonContainer) {
    const div = createDiv();
    div.className = buttonContainer.className; // Keep existing classes intact
    while (buttonContainer.firstChild) {
      div.appendChild(buttonContainer.firstChild);
    }
    buttonContainer.parentNode.replaceChild(div, buttonContainer);
  }

  // Survey state
  let surveyData = [];
  let currentQuestionIndex = 0;
  let surveyAnswers = {};
  let originalContent = '';

  function showQuestion(index) {
    currentQuestionIndex = index;
    const questionData = surveyData[index];

    const questionElement = createQuestion(questionData, index, surveyData);
    // Keep container class
    surveyArea.className = 'survey-area';
    replaceContent(surveyArea, questionElement);

    // eslint-disable-next-line no-use-before-define
    attachNavigationListeners();
    // eslint-disable-next-line no-use-before-define
    attachInputListeners();
  }

  // Start survey on click
  async function handleGetStartedClick(e) {
    e.preventDefault();

    const surveyDataPath = e.target.getAttribute('href');

    try {
      // Store original content
      originalContent = surveyArea.innerHTML;

      // Fetch + normalize survey data
      const data = await fetchSurveyData(surveyDataPath);
      console.log('Survey data loaded:', data);
      // Normalize/parse data shape
      surveyData = parseSurveyData(data);
      console.log('Parsed survey questions:', surveyData);

      // Start survey
      currentQuestionIndex = 0;
      surveyAnswers = {};
      showQuestion(0);
    } catch (error) {
      console.error('Failed to load survey data:', error);
      alert('Failed to load survey. Please try again.');
    }
  }

  // Wire up the Get Started button
  function attachGetStartedListener() {
    const getStartedButton = surveyArea.querySelector(
      '.button-container .button',
    );
    attachListeners([getStartedButton], 'click', handleGetStartedClick);
  }

  // Slider change handler
  function handleSliderInput(e, options, questionId) {
    const selectedIndex = parseInt(e.target.value, 10);
    surveyAnswers[questionId] = options[selectedIndex];

    // Update selected-* classes
    const trackWrapper = e.target.parentElement;

    // Remove all previous selection classes
    for (let i = 0; i < options.length; i += 1) {
      trackWrapper.classList.remove(`selected-${i}`);
    }

    // Add the current selection class
    trackWrapper.classList.add(`selected-${selectedIndex}`);

    // Clear error state when user makes a selection
    trackWrapper.classList.remove('error');
  }

  // Radio change handler
  function handleRadioChange(e, questionId) {
    surveyAnswers[questionId] = e.target.value;

    // Clear error state when user makes a selection
    const optionDiv = e.target.closest('.option');
    if (optionDiv) {
      // Clear error from all options in this question group
      const allOptions = surveyArea.querySelectorAll(
        `input[name="${questionId}"]`,
      );
      allOptions.forEach((option) => {
        const optDiv = option.closest('.option');
        if (optDiv) {
          optDiv.classList.remove('error');
        }
      });
    }
  }

  // Highlight invalid controls
  function addErrorState(question) {
    const currentQuestion = surveyData[currentQuestionIndex];

    if (currentQuestion.OptionType === SURVEY_CONSTANTS.RADIO_TYPE) {
      // For radio buttons, find all options for this question
      const options = surveyArea.querySelectorAll(
        `input[name="${question.ContentId}"]`,
      );
      options.forEach((option) => {
        const optionDiv = option.closest('.option');
        if (optionDiv) {
          optionDiv.classList.add('error');
        }
      });
    } else if (currentQuestion.OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
      // For sliders, find the specific slider track wrapper
      const slider = surveyArea.querySelector(
        `input[name="${question.ContentId}"]`,
      );
      if (slider) {
        const trackWrapper = slider.closest('.slider-track-wrapper');
        if (trackWrapper) {
          trackWrapper.classList.add('error');
        }
      }
    }
  }

  // Clear all error states
  function clearErrorStates() {
    const errorElements = surveyArea.querySelectorAll(
      '.option.error, .slider-track-wrapper.error',
    );
    errorElements.forEach((element) => {
      element.classList.remove('error');
    });
  }

  // Validate current slide (incl. grouped questions)
  function validateQuestions(relatedQuestions) {
    const invalidQuestions = relatedQuestions.filter((question) => {
      const isRequired = isAnswerRequired(question);
      const hasAnswer = hasValidAnswer(question, surveyAnswers);
      return isRequired && !hasAnswer;
    });

    if (invalidQuestions.length > 0) {
      // Clear any existing error states
      clearErrorStates();

      // Add error visual feedback to invalid questions
      invalidQuestions.forEach((question) => {
        addErrorState(question);
      });

      return false;
    }

    // Clear error states if validation passes
    clearErrorStates();
    return true;
  }

  // Wire inputs for the current slide
  function attachInputListeners() {
    const currentQuestion = surveyData[currentQuestionIndex];
    const relatedQuestions = findRelatedQuestions(
      surveyData,
      currentQuestionIndex,
    );

    if (currentQuestion.OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
      const sliders = surveyArea.querySelectorAll('.slider');

      sliders.forEach((slider, index) => {
        const trackWrapper = slider.parentElement;
        const questionData = relatedQuestions[index];
        const options = JSON.parse(slider.dataset.options);

        // Listen for changes
        slider.addEventListener('input', (e) => {
          handleSliderInput(e, options, questionData.ContentId);
        });

        // Initialize values and CSS classes
        if (surveyAnswers[questionData.ContentId]) {
          const answerIndex = options.indexOf(
            surveyAnswers[questionData.ContentId],
          );
          if (answerIndex !== -1) {
            slider.value = answerIndex;
            // Add selected class for previously made selection
            trackWrapper.classList.add(`selected-${answerIndex}`);
          }
        } else {
          const defaultIndex = parseInt(slider.value, 10);
          surveyAnswers[questionData.ContentId] = options[defaultIndex];
          // Add selected class for default value too since slider shows it as selected
          trackWrapper.classList.add(`selected-${defaultIndex}`);
        }
      });
    } else if (currentQuestion.OptionType === SURVEY_CONSTANTS.RADIO_TYPE) {
      const radioButtons = surveyArea.querySelectorAll(
        `input[name="${currentQuestion.ContentId}"]`,
      );

      attachListeners(radioButtons, 'change', (e) => {
        handleRadioChange(e, currentQuestion.ContentId);
      });

      // Restore previous answers
      radioButtons.forEach((radio) => {
        if (surveyAnswers[currentQuestion.ContentId] === radio.value) {
          radio.checked = true;
        }
      });
    }
  }

  // Back/Next handler (validate on next). Emits custom events.
  function handleNavigation(direction) {
    if (direction === 'next') {
      const relatedQuestions = findRelatedQuestions(
        surveyData,
        currentQuestionIndex,
      );

      if (!validateQuestions(relatedQuestions)) {
        return;
      }
    }

    // Emit custom event
    surveyArea.dispatchEvent(new CustomEvent(`survey:${direction}`));
  }

  // Bind nav buttons
  function attachNavigationListeners() {
    const buttons = [
      { element: surveyArea.querySelector('.btn-back'), direction: 'back' },
      { element: surveyArea.querySelector('.btn-next'), direction: 'next' },
    ];

    buttons.forEach(({ element, direction }) => {
      if (element) {
        element.addEventListener('click', () => handleNavigation(direction));
      }
    });
  }

  // Find the first item in a grouped set
  function findGroupStart(startIndex) {
    let index = startIndex;
    const targetQuestion = surveyData[index];
    const targetBaseId = targetQuestion.ContentId.replace(/[a-z]$/, '');

    // If not a grouped question, return as-is
    if (targetBaseId === targetQuestion.ContentId) {
      return index;
    }

    // Find the first question in the group
    while (index > 0) {
      const prevQ = surveyData[index - 1];
      const prevBaseId = prevQ.ContentId.replace(/[a-z]$/, '');

      if (prevBaseId === targetBaseId && prevBaseId !== prevQ.ContentId) {
        index -= 1;
      } else {
        break;
      }
    }

    return index;
  }

  // Jump past grouped siblings to the next question
  function getNextQuestionIndex() {
    const relatedQuestions = findRelatedQuestions(
      surveyData,
      currentQuestionIndex,
    );
    const questionsToSkip = relatedQuestions.length - 1;
    return currentQuestionIndex + 1 + questionsToSkip;
  }

  // Survey navigation event handlers
  if (surveyArea) {
    // Handle back navigation
    surveyArea.addEventListener('survey:back', () => {
      if (currentQuestionIndex === 0) {
        // Go back to original content (trusted content, can use innerHTML)
        replaceContent(surveyArea);
        surveyArea.innerHTML = originalContent;
        attachGetStartedListener();
      } else {
        const prevIndex = findGroupStart(currentQuestionIndex - 1);
        showQuestion(prevIndex);
      }
    });

    // Handle next/forward navigation
    surveyArea.addEventListener('survey:next', () => {
      const nextIndex = getNextQuestionIndex();

      if (nextIndex < surveyData.length) {
        showQuestion(nextIndex);
      } else {
        // Done: mark progress UI and show summary
        const progressDiv = surveyArea.querySelector('.progress');
        if (progressDiv) {
          // Check if "Complete!" span doesn't already exist
          if (!progressDiv.querySelector('.progress-complete')) {
            const completeSpan = createElement(
              'span',
              'progress-complete',
              'Complete!',
            );
            progressDiv.insertBefore(completeSpan, progressDiv.firstChild);
          }
        }

        // Swap content for answers summary (UL/LI)
        const contentDiv = surveyArea.querySelector('.content');
        if (contentDiv) {
          // Create header wrapper with title and subtitle
          const header = createDiv('answers-list-header');
          const answersHeading = createElement(
            'h1',
            'answers-title',
            'Your Answers',
          );
          const subtitleText = createElement(
            'p',
            'answers-subtitle',
            'Be sure to save your answers below to share with your healthcare provider. Ask your healthcare provider about adding REXULTI to your antidepressant—an open conversation may help get you where you want to be.',
          );
          appendChildren(header, [answersHeading, subtitleText]);

          // Build semantic UL/LI answers list
          const listEl = createAnswersListUL(surveyData, surveyAnswers);
          const answersList = createDiv('answers-list');
          if (listEl) answersList.appendChild(listEl);

          // Compose and replace content
          const container = appendChildren(createDiv(), [header, answersList]);
          replaceContent(contentDiv, container);
        }

        // Show footer after completion: thanks + save + learn more
        const footerDiv = block.querySelector('.footer-content');
        if (footerDiv) {
          // Create thank you message
          const thankYouMessage = createElement(
            'p',
            'survey-thank-you',
            'Thank you for completing this Depression Journey Questionnaire.',
          );

          // Create save answers button
          const saveButton = createButton('button', 'Save Your Answers');
          saveButton.id = 'save-answers';

          // Create learn more link
          const learnMoreLink = createElement(
            'a',
            'survey-learn-more',
            'Learn more about depression and Partial Response',
            {
              href: '#',
            },
          );
          const learnMoreParagraph = createElement('p');
          learnMoreParagraph.appendChild(learnMoreLink);

          // Insert new elements at the beginning of footer
          const footerContentDiv = footerDiv.querySelector('div');
          if (footerContentDiv) {
            footerContentDiv.insertBefore(
              thankYouMessage,
              footerContentDiv.firstChild,
            );
            footerContentDiv.appendChild(saveButton);
            footerContentDiv.appendChild(learnMoreParagraph);
          }

          // Make footer visible
          footerDiv.style.display = 'block';
        }

        console.log('Survey completed:', surveyAnswers);
      }
    });
  }

  // Initialize Get Started button
  if (surveyArea) {
    attachGetStartedListener();
  }

  addClassIf(footer, 'footer-content');
}
