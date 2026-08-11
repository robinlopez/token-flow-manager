import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { TemplateLogo } from '../../core/models';

/**
 * Brand mark of a starter template, inlined as SVG.
 *
 * Inline rather than `<img src>` so the marks scale with the card, need no
 * network round-trip (the dashboard is served from a local binary) and carry no
 * duplicate element ids: the Semantic DS mark is redrawn as four solid diamonds
 * instead of the original mask + drop-shadow filter stack, which would clash
 * with itself when the same logo renders in the grid and in the dialog.
 */
@Component({
  selector: 'tf-template-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' },
  template: `
    @switch (logo()) {
      @case ('tailwind') {
        <svg viewBox="0 0 54 33" fill="none" class="w-full h-full" aria-hidden="true">
          <path
            fill="#38BDF8"
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M27 0c-7.2 0-11.7 3.6-13.5 10.8 2.7-3.6 5.85-4.95 9.45-4.05 2.054.513 3.522 2.004 5.147 3.653C30.744 13.09 33.808 16.2 40.5 16.2c7.2 0 11.7-3.6 13.5-10.8-2.7 3.6-5.85 4.95-9.45 4.05-2.054-.513-3.522-2.004-5.147-3.653C36.756 3.11 33.692 0 27 0zM13.5 16.2C6.3 16.2 1.8 19.8 0 27c2.7-3.6 5.85-4.95 9.45-4.05 2.054.514 3.522 2.004 5.147 3.653C17.244 29.29 20.308 32.4 27 32.4c7.2 0 11.7-3.6 13.5-10.8-2.7 3.6-5.85 4.95-9.45 4.05-2.054-.513-3.522-2.004-5.147-3.653C23.256 19.31 20.192 16.2 13.5 16.2z"
          />
        </svg>
      }
      @case ('material') {
        <svg viewBox="0 0 24 24" class="w-full h-full" aria-hidden="true">
          <path
            fill="#6750A4"
            d="M21,12a9,9,0,0,0-2-5.62V17.63A8.78,8.78,0,0,0,21,12m-3.37,7H6.38a9.5,9.5,0,0,0,2.67,1.41A8.91,8.91,0,0,0,12,21,8.86,8.86,0,0,0,15,20.41,9.72,9.72,0,0,0,17.63,19M11,17,7,9v8h4m6-8-4,8h4V9m-5,5.53L15.75,7H8.25L12,14.53M17.63,5A8.91,8.91,0,0,0,6.38,5H17.63M5,17.63V6.38A9,9,0,0,0,3,12a8.78,8.78,0,0,0,2,5.63M23,12a10.57,10.57,0,0,1-3.22,7.78A10.57,10.57,0,0,1,12,23a10.59,10.59,0,0,1-7.78-3.22A10.57,10.57,0,0,1,1,12,10.59,10.59,0,0,1,4.22,4.22,10.59,10.59,0,0,1,12,1a10.57,10.57,0,0,1,7.78,3.22A10.59,10.59,0,0,1,23,12Z"
          />
        </svg>
      }
      @case ('semantic-ds') {
        <svg viewBox="0 0 122.5 120" fill="none" class="w-full h-full" aria-hidden="true">
          <path
            fill="#9747FF"
            d="M91.25 116.25H31.25C16.7525 116.25 5 104.497 5 90V30C5 15.5025 16.7525 3.75 31.25 3.75H91.25C105.747 3.75 117.5 15.5025 117.5 30V90C117.5 104.497 105.747 116.25 91.25 116.25Z"
          />
          <g fill="#FFFFFF">
            <path
              d="M58.3565 27.4485C59.9545 25.8505 62.5454 25.8505 64.1435 27.4485L73.9993 37.3044C75.5974 38.9024 75.5974 41.4933 73.9993 43.0913L64.1435 52.9472C62.5454 54.5452 59.9545 54.5452 58.3565 52.9472L48.5007 43.0913C46.9027 41.4933 46.9027 38.9024 48.5007 37.3044L58.3565 27.4485Z"
            />
            <path
              d="M78.1587 47.2507C79.7567 45.6527 82.3476 45.6527 83.9456 47.2507L93.8015 57.1065C95.3995 58.7046 95.3995 61.2955 93.8015 62.8935L83.9456 72.7493C82.3476 74.3474 79.7567 74.3474 78.1587 72.7493L68.3028 62.8935C66.7048 61.2955 66.7048 58.7046 68.3028 57.1065L78.1587 47.2507Z"
            />
            <path
              d="M38.5544 47.2507C40.1524 45.6527 42.7433 45.6527 44.3413 47.2507L54.1972 57.1065C55.7952 58.7046 55.7952 61.2955 54.1972 62.8935L44.3413 72.7493C42.7433 74.3474 40.1524 74.3474 38.5544 72.7493L28.6985 62.8935C27.1005 61.2955 27.1005 58.7046 28.6985 57.1065L38.5544 47.2507Z"
            />
            <path
              d="M58.3565 67.0528C59.9545 65.4548 62.5454 65.4548 64.1435 67.0528L73.9993 76.9087C75.5974 78.5067 75.5974 81.0976 73.9993 82.6956L64.1435 92.5515C62.5454 94.1495 59.9545 94.1495 58.3565 92.5515L48.5007 82.6956C46.9027 81.0976 46.9027 78.5067 48.5007 76.9087L58.3565 67.0528Z"
            />
          </g>
        </svg>
      }
      @case ('figma') {
        <svg viewBox="0 0 200 300" class="w-full h-[88%]" aria-hidden="true">
          <path fill="#0ACF83" d="M50 300c27.6 0 50-22.4 50-50v-50H50c-27.6 0-50 22.4-50 50s22.4 50 50 50z" />
          <path fill="#A259FF" d="M0 150c0-27.6 22.4-50 50-50h50v100H50c-27.6 0-50-22.4-50-50z" />
          <path fill="#F24E1E" d="M0 50C0 22.4 22.4 0 50 0h50v100H50C22.4 100 0 77.6 0 50z" />
          <path fill="#FF7262" d="M100 0h50c27.6 0 50 22.4 50 50s-22.4 50-50 50h-50V0z" />
          <path fill="#1ABCFE" d="M200 150c0 27.6-22.4 50-50 50s-50-22.4-50-50 22.4-50 50-50 50 22.4 50 50z" />
        </svg>
      }
    }
  `,
})
export class TemplateLogoComponent {
  readonly logo = input.required<TemplateLogo>();
}
